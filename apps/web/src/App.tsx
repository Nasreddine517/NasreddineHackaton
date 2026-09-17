import { useEffect, useState } from 'react';
import {
  ArrowUpRight,
  AudioLines,
  Check,
  CircleDashed,
  MessageCircle,
  ShieldCheck,
  ShoppingBag,
  Store,
} from 'lucide-react';

type Health = { status: string; services: { postgres: boolean; redis: boolean; worker: boolean } };

export function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [checked, setChecked] = useState(false);
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    fetch('/api/health/ready', { signal: abort.signal })
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => {})
      .finally(() => {
        if (!abort.signal.aborted) setChecked(true);
      });
    const ws = new WebSocket(
      `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/events`,
    );
    ws.onmessage = (event) => {
      try {
        if (JSON.parse(event.data).type === 'connected') setConnected(true);
      } catch {}
    };
    ws.onclose = () => setConnected(false);
    return () => {
      abort.abort();
      ws.close();
    };
  }, []);

  return (
    <div className="page">
      <header className="header">
        <a className="brand" href="/" aria-label="Kenza, accueil">
          <span className="brand-mark">k.</span>kenza<span className="brand-dot">.</span>
        </a>
        <span className="header-caption">L’attention qui fait la différence.</span>
        <span className="build-badge">
          <span /> En construction
        </span>
      </header>
      <main>
        <section className="hero">
          <div className="hero-copy">
            <div className="eyebrow">
              <span /> LE COMMERCE COMMENCE PAR UN ÉCHANGE
            </div>
            <h1>
              Une conversation.
              <br />
              Mille façons de
              <br />
              <em>bien vous conseiller.</em>
            </h1>
            <p className="lead">
              Une assistante qui comprend vos envies, connaît sa boutique et prend le temps de vous
              accompagner.
            </p>
            <div className="languages">
              <span>Français</span>
              <i />
              <span lang="ar" dir="rtl">
                العربية
              </span>
              <i />
              <span>Darija</span>
            </div>
            <div className="hero-note">
              <ShieldCheck size={18} />
              <span>Des conseils fondés sur les produits de la boutique.</span>
            </div>
          </div>
          <div className="illustration" aria-label="Présentation des deux espaces de Kenza">
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <span className="floating-label">
              <AudioLines size={16} /> À votre écoute
            </span>
            <div className="main-card">
              <div className="card-top">
                <span className="avatar">k.</span>
                <div>
                  <strong>Un accueil qui vous ressemble</strong>
                  <span>Texte, voix et images</span>
                </div>
                <MessageCircle size={22} />
              </div>
              <div className="sample-greeting" lang="ar" dir="rtl">
                مرحبا بيك عند كينزا
              </div>
              <p>
                Du premier « salam »<br />
                au choix qui vous convient.
              </p>
              <div className="card-bottom">
                <ShoppingBag size={18} />
                <span>Une boutique, toujours le même soin.</span>
              </div>
            </div>
            <span className="floating-seal">
              <ShieldCheck size={21} /> Le commerçant garde la main
            </span>
          </div>
        </section>
        <section className="spaces" aria-label="Les espaces Kenza">
          <article className="space-card">
            <div className="space-icon">
              <MessageCircle />
            </div>
            <div>
              <span className="overline">POUR VOS CLIENTS</span>
              <h2>La boutique, en conversation</h2>
              <p>Demander un conseil, trouver un article, préparer sa commande.</p>
            </div>
            <span className="soon">
              Lot 3 <ArrowUpRight size={16} />
            </span>
          </article>
          <article className="space-card">
            <div className="space-icon">
              <Store />
            </div>
            <div>
              <span className="overline">POUR LE COMMERÇANT</span>
              <h2>Une vue sur chaque échange</h2>
              <p>Suivre les commandes et intervenir au moment où cela compte.</p>
            </div>
            <span className="soon">
              Lots 3–5 <ArrowUpRight size={16} />
            </span>
          </article>
        </section>
        <section className="foundation" aria-labelledby="foundation-title">
          <div>
            <span className="overline">AVANCEMENT DU PROJET</span>
            <h2 id="foundation-title">Le socle prend forme.</h2>
            <p>
              Cette première version vérifie les services. Les parcours d’achat et de supervision
              seront ouverts dans les prochains lots.
            </p>
          </div>
          <ul className="service-list" aria-live="polite">
            {[
              ['API', Boolean(health)],
              ['PostgreSQL', health?.services.postgres],
              ['Redis', health?.services.redis],
              ['Worker', health?.services.worker],
              ['WebSocket', connected],
            ].map(([label, ready]) => (
              <li key={String(label)} className={ready ? 'ready' : ''}>
                {ready ? <Check size={15} /> : <CircleDashed size={15} />}
                <span>{label}</span>
                <small>{ready ? 'Connecté' : checked ? 'Indisponible' : 'Vérification…'}</small>
              </li>
            ))}
          </ul>
        </section>
      </main>
      <footer>
        <span>
          kenza. <span>La proximité, à chaque message.</span>
        </span>
        <span>ESISA × Numeos · 2026</span>
      </footer>
    </div>
  );
}
