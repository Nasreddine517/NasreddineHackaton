import type { FastifyInstance } from 'fastify';
import type { createConnections } from '../../../packages/core/src/connections.js';
import type { registerCommerce } from './commerce.js';
import crypto from 'node:crypto';
import { toFile } from 'openai';
import { readConfig } from '../../../packages/core/src/config.js';
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
    if (!body?.audio) throw new Error("Audio manquant");
    
    const config = readConfig();
    const azureClient = createAzureClient(config);
    const buffer = Buffer.from(body.audio, 'base64');
    const file = await toFile(buffer, 'audio.webm');
    
    try {
      const transcription = await azureClient.audio.transcriptions.create({
        file,
        model: 'whisper',
      });
      if (!transcription.text) throw new Error("Échec de la transcription");
      return service.send(id, { id: crypto.randomUUID(), message: transcription.text });
    } catch (err) {
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
