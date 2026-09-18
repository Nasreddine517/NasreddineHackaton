import type { FastifyInstance } from 'fastify';
import type { createConnections } from '../../../packages/core/src/connections.js';
import type { registerCommerce } from './commerce.js';
import crypto from 'node:crypto';
import { toFile } from 'openai';
import { readConfig } from '../../../packages/core/src/config.js';
import { BusinessError } from '../../../packages/core/src/domain/pricing.js';
import { createAzureClient } from '../../../packages/core/src/llm/clients.js';
import {
  createConversationService,
  withConversationLock,
} from '../../../packages/core/src/agents/conversation.js';
import { registerSupervision } from './supervision.js';
import type { AgentModels } from '../../../packages/core/src/agents/models.js';
import { FOLLOWUP_CHANNEL } from '../../../packages/core/src/domain/followups.js';

type Socket = { readyState: number; send(data: string): void; close(): void };
export async function registerChat(
  app: FastifyInstance,
  { db, redis }: ReturnType<typeof createConnections>,
  auth: Awaited<ReturnType<typeof registerCommerce>>,
  models: AgentModels,
) {
  const sockets = new Map<string, Set<Socket>>();
  function notify(customerId: string, event: Record<string, unknown>) {
    for (const socket of sockets.get(customerId) ?? []) {
      if (socket.readyState === 1) socket.send(JSON.stringify(event));
    }
  }
  const service = await createConversationService(db, models, notify);
  const subscriber = redis.duplicate();
  subscriber.on('error', () => {});
  subscriber.on('message', (_channel, message) => {
    try {
      const value = JSON.parse(message);
      if (typeof value.customerId === 'string')
        notify(value.customerId, { type: 'conversation.updated' });
    } catch {}
  });
  await subscriber.subscribe(FOLLOWUP_CHANNEL);
  app.post('/api/client/followups/refuse', async (request) => {
    const id = await auth.session(request, 'client');
    await withConversationLock(db, id, async (connection) => {
      await connection.query(
        `INSERT INTO conversations(customer_id,followup_refused) VALUES ($1,true)
        ON CONFLICT(customer_id) DO UPDATE SET followup_refused=true`,
        [id],
      );
    });
    notify(id, { type: 'conversation.updated' });
    return { refused: true };
  });
  app.get('/api/client/conversation', async (request) =>
    service.history(await auth.session(request, 'client')),
  );
  app.post('/api/client/messages', async (request) => {
    const id = await auth.session(request, 'client');
    await auth.rateLimit(`rate:chat:${id}`, 30);
    return service.send(id, request.body);
  });

  app.post('/api/client/messages/audio', async (request) => {
    const id = await auth.session(request, 'client');
    await auth.rateLimit(`rate:chat:${id}`, 30);
    const body = request.body as { audio?: string };
    if (!body?.audio) throw new Error('Audio manquant');

    const config = readConfig();
    if (!config.GROQ_API_KEY) throw new Error("Le service vocal n'est pas configuré.");

    try {
      // Azure n'a aucun déploiement audio (Whisper/gpt-4o-audio) : on transcrit via
      // l'API Whisper gratuite de Groq, compatible OpenAI, qui accepte le webm brut.
      const buffer = Buffer.from(body.audio, 'base64');
      // Un enregistrement trop court (clic accidentel) donne un flux quasi silencieux
      // que Whisper "hallucine" en texte générique (ex: "Thank you for watching!").
      if (buffer.length < 4000)
        throw new BusinessError(
          'AUDIO_TOO_SHORT',
          "Message trop court : maintenez le bouton un peu plus longtemps en parlant.",
        );
      // Sans indication de langue, Whisper devine parfois une langue totalement
      // différente sur un audio court/bruité (ex: portugais). On force la langue
      // à partir de la préférence connue du client pour éviter ces erreurs.
      const { rows } = await db.query<{ preferred_language: string | null }>(
        'SELECT preferred_language FROM customers WHERE id=$1',
        [id],
      );
      const whisperLanguage = rows[0]?.preferred_language === 'fr' ? 'fr' : 'ar';
      const file = await toFile(buffer, 'audio.webm', { type: 'audio/webm' });
      const form = new FormData();
      form.append('file', file);
      form.append('model', config.GROQ_STT_MODEL);
      form.append('response_format', 'verbose_json');
      form.append('language', whisperLanguage);
      // Aide le modèle à choisir le bon script (arabe/latin) pour le darija sans forcer une langue.
      form.append(
        'prompt',
        "Conversation en français, arabe ou darija marocaine dans une boutique de vêtements.",
      );
      const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.GROQ_API_KEY}` },
        body: form,
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        request.log.error({ status: response.status, detail, bytes: buffer.length }, 'Groq rejected audio');
        throw new Error(`Groq transcription failed: ${response.status}`);
      }
      const result = (await response.json()) as {
        text?: string;
        segments?: { no_speech_prob?: number; text?: string }[];
      };
      const text = result.text?.trim();
      // Heuristique anti-hallucination : Whisper invente souvent des phrases plausibles
      // ("Thank you for watching", "you", "Sous-titres...") quand il ne détecte pas de vraie parole.
      const segments = result.segments ?? [];
      const silent =
        segments.length > 0 && segments.every((s) => (s.no_speech_prob ?? 0) > 0.6);
      const knownHallucinations = [
        /^(thank you( for watching)?!?|thanks for watching!?|you)$/i,
        /sous-?titr/i,
        /subtitle/i,
        /amara\.org/i,
      ];
      if (!text || silent || knownHallucinations.some((re) => re.test(text)))
        throw new BusinessError(
          'AUDIO_NOT_UNDERSTOOD',
          "Je n'ai pas bien capté votre message vocal. Pouvez-vous réessayer, en parlant un peu plus près du micro ?",
        );
      return service.send(id, { id: crypto.randomUUID(), message: text });
    } catch (err) {
      if (err instanceof BusinessError) throw err;
      request.log.error(err, 'Audio transcription failed');
      throw new Error("Le service vocal n'est pas disponible pour le moment.");
    }
  });

  app.post('/api/client/messages/image', async (request) => {
    const id = await auth.session(request, 'client');
    await auth.rateLimit(`rate:chat:${id}`, 30);
    const body = request.body as { image?: string };
    if (!body?.image) throw new Error("Image manquante");
    
    const config = readConfig();
    const azureClient = createAzureClient(config);
    
    try {
      const response = await azureClient.chat.completions.create({
        model: config.AZURE_OPENAI_DEPLOYMENT_NAME,
        max_tokens: 150,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Décris précisément le vêtement principal sur cette image (type, couleur, matière, style) de manière très concise (15 mots max), pour aider un système de recherche catalogue." },
              { type: "image_url", image_url: { url: body.image } }
            ]
          }
        ]
      });
      
      const description = response.choices[0]?.message.content?.trim() || "Vêtement non reconnu";
      const text = `[Image attachée : ${description}] Je cherche ce type d'article.`;
      return service.send(id, { id: crypto.randomUUID(), message: text });
    } catch (err) {
      request.log.error(err, 'Image analysis failed');
      throw new Error("L'analyse visuelle n'est pas disponible pour le moment.");
    }
  });
  app.get(
    '/api/client/events',
    {
      websocket: true,
      preValidation: async (request) => {
        const origin = request.headers.origin;
        if (
          !origin ||
          new URL(origin).host !== request.headers.host ||
          request.headers['sec-fetch-site'] === 'cross-site'
        )
          throw Object.assign(new Error('Denied'), { statusCode: 403 });
        await auth.session(request, 'client');
      },
    },
    (socket, request) => {
      let customerId: string | undefined,
        closed = false;
      socket.on('error', () => {});
      socket.on('close', () => {
        closed = true;
        if (customerId) {
          sockets.get(customerId)?.delete(socket);
          if (!sockets.get(customerId)?.size) sockets.delete(customerId);
        }
      });
      void auth
        .session(request, 'client')
        .then((id) => {
          if (closed) return;
          customerId = id;
          const group = sockets.get(id) ?? new Set<Socket>();
          group.add(socket);
          sockets.set(id, group);
          socket.send(JSON.stringify({ type: 'connected' }));
        })
        .catch(() => socket.close());
      // Revalidate the cookie periodically, including after a profile switch or expiry.
      const check = setInterval(() => {
        void auth.session(request, 'client').catch(() => socket.close());
      }, 30_000);
      socket.on('close', () => clearInterval(check));
    },
  );
  app.addHook('onClose', async () => {
    subscriber.disconnect();
    for (const group of sockets.values()) for (const socket of group) socket.close();
  });

  await registerSupervision(app, db, auth, notify);
  return service;
}
