import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowLeft, ShoppingBag, Trash2, Store } from 'lucide-react';
import { Chat } from './Chat';
import { MerchantConversations } from './MerchantConversations';
import { MerchantFollowups } from './MerchantFollowups';
import type { Product } from '../../../packages/core/src/domain/catalogue.js';
import type { CheckoutSnapshot } from '../../../packages/core/src/domain/checkout.js';

const money = (n: number) =>
  new Intl.NumberFormat('fr-MA', { style: 'currency', currency: 'MAD' }).format(n / 100);
async function api<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  const response = await fetch(
    `/api${path}`,
    body === undefined
      ? {}
      : {
          method,
          headers: { 'content-type': 'application/json', 'x-kenza-request': '1' },
          body: JSON.stringify(body),
        },
  );
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      response.status === 401
        ? 'Connectez-vous pour accéder à cet espace.'
        : response.status === 503
          ? 'L’accès commerçant doit être configuré dans le fichier .env.'
          : response.status === 429
            ? 'Trop de tentatives. Réessayez dans quelques minutes.'
            : data.message || 'Service indisponible.',
    );
  return data as T;
}
type Profile = { id: string; name: string; city: string };
type Item = {
  ref: string;
  model: string;
  size: string;
  color: string;
  quantity: number;
  stock: number;
  catalogueCentimes: number;
};
type Zone = { city: string; cash_on_delivery: boolean; pickup: boolean };
type Order = {
  id: string;
  created_at: string;
  total_centimes: number;
  customer_name?: string;
  delivery_city?: string;
  delivery_address?: string;
  payment_method: string;
  fulfillment_method?: string;
  lines?: { ref: string; model: string; size: string; quantity: number; unitCentimes: number }[];
};
type Quote = CheckoutSnapshot & { id: string; expiresAt: string };
const paymentLabel: Record<string, string> = {
  cash_on_delivery: 'À la livraison',
  bank_transfer: 'Virement bancaire',
  card_link: 'Carte via lien de paiement',
};

export function Commerce({ mode, onBack }: { mode: 'client' | 'merchant'; onBack: () => void }) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [merchant, setMerchant] = useState(false);
  const [query, setQuery] = useState('');
  const [city, setCity] = useState('');
  const [method, setMethod] = useState<'delivery' | 'pickup'>('delivery');
  const [payment, setPayment] = useState('bank_transfer');
  const [address, setAddress] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Service indisponible.');
    } finally {
      setBusy(false);
    }
  }
  async function refreshClient() {
    const [cart, history] = await Promise.all([
      api<{ items: Item[] }>('/client/cart'),
      api<{ orders: Order[] }>('/client/orders'),
    ]);
    setItems(cart.items);
    setOrders(history.orders);
  }
  async function refreshMerchant() {
    const result = await api<{ orders: Order[] }>('/merchant/orders');
    setOrders(result.orders);
    setMerchant(true);
  }
  useEffect(() => {
    let active = true;
    if (mode === 'client') {
      Promise.all([
        api<{ profiles: Profile[] }>('/demo/profiles'),
        api<{ zones: Zone[] }>('/delivery-zones'),
        api<{ products: Product[] }>('/catalogue'),
      ])
        .then(([p, z, c]) => {
          if (active) {
            setProfiles(p.profiles);
            setZones(z.zones);
            setProducts(c.products);
          }
        })
        .catch(() => {
          if (active) setError('La boutique est momentanément indisponible.');
        });
      api<Profile>('/client/me')
        .then(async (p) => {
          if (active) {
            setProfile(p);
            setCity(p.city);
            await refreshClient();
          }
        })
        .catch(() => {});
    } else refreshMerchant().catch(() => {});
    return () => {
      active = false;
    };
  }, [mode]);
  async function identify(body: unknown) {
    await api('/demo/session', body);
    const me = await api<Profile>('/client/me');
    setProfile(me);
    setCity(me.city);
    setQuote(null);
    await refreshClient();
  }
  async function editItem(ref: string, quantity: number) {
    await action(async () => {
      const cart = await api<{ items: Item[] }>('/client/cart', { ref, quantity }, 'PUT');
      setItems(cart.items);
      setQuote(null);
    });
  }
  function submit(event: FormEvent<HTMLFormElement>, fn: (data: FormData) => Promise<void>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void action(() => fn(data));
  }
  const selectedZone = zones.find((z) => z.city === city);
  return (
    <div className="page commerce">
      <header className="header">
        <a className="brand" href="/">
          kenza<span className="brand-dot">.</span>
        </a>
        <span className="header-caption">
          {mode === 'client' ? 'Votre boutique' : 'Espace commerçant'}
        </span>
        <button className="text-button" onClick={onBack}>
          <ArrowLeft size={16} /> Accueil
        </button>
      </header>
      <main>
        <div className="commerce-heading">
          <div>
            <span className="overline">
              {mode === 'client' ? 'LE PLAISIR DE CHOISIR' : 'LE SUIVI DE VOTRE BOUTIQUE'}
            </span>
            <h1>
              {mode === 'client'
                ? 'Trouvons votre prochain coup de cœur.'
                : 'Vos commandes, en un regard.'}
            </h1>
          </div>
          {mode === 'client' ? <ShoppingBag size={36} /> : <Store size={36} />}
        </div>
        {error && (
          <div className="alert error" role="alert">
            {error}
          </div>
        )}
        {notice && (
          <div className="alert" role="status">
            {notice}
          </div>
        )}
        {mode === 'client' && (
          <>
            <section className="panel identity">
              <div>
                <h2>{profile ? `Bienvenue, ${profile.name}` : 'Entrez dans la boutique'}</h2>
                <p>
                  Simulateur du hackathon : les profils sont fictifs et partagés. Choisissez le même
                  profil pour retrouver son panier.
                </p>
              </div>
              <form
                onSubmit={(e) =>
                  submit(e, (d) => identify({ customerId: String(d.get('profile')) }))
                }
              >
                <label>
                  Profil de démonstration
                  <select name="profile" required defaultValue="">
                    <option value="" disabled>
                      Choisir un profil
                    </option>
                    {profiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} · {p.id}
                      </option>
                    ))}
                  </select>
                </label>
                <button disabled={busy}>Entrer</button>
              </form>
              <details>
                <summary>Créer un profil fictif</summary>
                <form
                  onSubmit={(e) =>
                    submit(e, (d) =>
                      identify({ name: String(d.get('name')), city: String(d.get('city')) }),
                    )
                  }
                >
                  <label>
                    Prénom fictif
                    <input name="name" minLength={2} maxLength={80} required />
                  </label>
                  <label>
                    Ville
                    <select name="city" required>
                      {zones.map((z) => (
                        <option key={z.city}>{z.city}</option>
                      ))}
                    </select>
                  </label>
                  <button disabled={busy}>Créer et entrer</button>
                </form>
              </details>
            </section>
            {profile && (
              <Chat
                key={profile.id}
                customerId={profile.id}
                onChanged={refreshClient}
                onAdd={(ref) =>
                  editItem(ref, (items.find((i) => i.ref === ref)?.quantity ?? 0) + 1)
                }
              />
            )}
            <div className="shop-layout">
              <aside className="panel basket">
                <h2>
                  Votre sélection{' '}
                  <span className="count">{items.reduce((s, i) => s + i.quantity, 0)}</span>
                </h2>
                <p className="muted">Le stock est réservé uniquement à la confirmation.</p>
                {!items.length && (
                  <p>
                    {profile
                      ? 'Votre panier attend vos envies.'
                      : 'Choisissez un profil pour préparer votre panier.'}
                  </p>
                )}
                {items.map((i) => (
                  <div className="cart-item" key={i.ref}>
                    <strong>{i.model}</strong>
                    <small>
                      {i.color} · {i.size}
                    </small>
                    <div className="quantity">
                      <button
                        aria-label={`Diminuer ${i.ref}`}
                        disabled={busy}
                        onClick={() => void editItem(i.ref, i.quantity - 1)}
                      >
                        −
                      </button>
                      <span>{i.quantity}</span>
                      <button
                        aria-label={`Augmenter ${i.ref}`}
                        disabled={busy || i.quantity >= Math.min(i.stock, 20)}
                        onClick={() => void editItem(i.ref, i.quantity + 1)}
                      >
                        +
                      </button>
                      <button
                        className="text-button"
                        aria-label={`Retirer ${i.ref}`}
                        disabled={busy}
                        onClick={() => void editItem(i.ref, 0)}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                ))}
                {!!items.length && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void action(async () =>
                        setQuote(
                          await api<Quote>('/client/checkout/quote', {
                            city,
                            method,
                            address: method === 'pickup' ? '' : address,
                            payment,
                          }),
                        ),
                      );
                    }}
                  >
                    <label>
                      Ville
                      <select
                        value={city}
                        required
                        onChange={(e) => {
                          setCity(e.target.value);
                          setMethod('delivery');
                          setPayment('bank_transfer');
                          setQuote(null);
                        }}
                      >
                        <option value="">Choisir une ville</option>
                        {zones.map((z) => (
                          <option key={z.city}>{z.city}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Réception
                      <select
                        value={method}
                        onChange={(e) => {
                          setMethod(e.target.value as 'delivery' | 'pickup');
                          setPayment('bank_transfer');
                          setQuote(null);
                        }}
                      >
                        <option value="delivery">Livraison</option>
                        {selectedZone?.pickup && (
                          <option value="pickup">Retrait en boutique</option>
                        )}
                      </select>
                    </label>
                    {method === 'delivery' && (
                      <label>
                        Adresse complète
                        <textarea
                          required
                          minLength={5}
                          maxLength={400}
                          value={address}
                          onChange={(e) => {
                            setAddress(e.target.value);
                            setQuote(null);
                          }}
                        />
                      </label>
                    )}
                    <label>
                      Paiement prévu
                      <select
                        value={payment}
                        onChange={(e) => {
                          setPayment(e.target.value);
                          setQuote(null);
                        }}
                      >
                        <option value="bank_transfer">Virement bancaire</option>
                        <option value="card_link">Carte via lien de paiement</option>
                        {method === 'delivery' && selectedZone?.cash_on_delivery && (
                          <option value="cash_on_delivery">À la livraison</option>
                        )}
                      </select>
                    </label>
                    <p className="muted">
                      Aucun paiement n’est encaissé dans ce simulateur. Les modalités de règlement
                      restent à organiser avec le commerçant.
                    </p>
                    <button disabled={busy}>Vérifier le total</button>
                  </form>
                )}
                {quote && (
                  <section className="quote" aria-label="Récapitulatif de commande">
                    <h3>Vérifiez avant de confirmer</h3>
                    {quote.lines.map((l) => (
                      <p key={l.ref}>
                        {l.quantity} × {l.model} · {l.size}
                        <strong>{money(l.unitCentimes * l.quantity)}</strong>
                        {l.source === 'promotion' && <small>Promotion appliquée</small>}
                      </p>
                    ))}
                    <p>
                      {quote.delivery.method === 'pickup' ? 'Retrait' : 'Livraison'} ·{' '}
                      {quote.delivery.city}
                      <strong>{money(quote.delivery.feeCentimes)}</strong>
                    </p>
                    <p>Délai indiqué : {quote.delivery.delayHours} h</p>
                    <p className="total">
                      Total<strong>{money(quote.totalCentimes)}</strong>
                    </p>
                    <small>
                      Récapitulatif valable 10 minutes. Prix et stock revérifiés à la confirmation.
                    </small>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void action(async () => {
                          const result = await api<{ orderId: string }>(
                            '/client/checkout/confirm',
                            { quoteId: quote.id, confirmed: true },
                          );
                          setQuote(null);
                          await refreshClient();
                          setNotice(
                            `Commande confirmée : ${result.orderId}. Aucun paiement n’a été encaissé.`,
                          );
                          setProducts(
                            (
                              await api<{ products: Product[] }>(
                                `/catalogue?q=${encodeURIComponent(query)}`,
                              )
                            ).products,
                          );
                        })
                      }
                    >
                      Confirmer ma commande · {money(quote.totalCentimes)}
                    </button>
                  </section>
                )}
              </aside>
              <section>
                <form
                  className="search-row"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void action(async () =>
                      setProducts(
                        (
                          await api<{ products: Product[] }>(
                            `/catalogue?q=${encodeURIComponent(query)}`,
                          )
                        ).products,
                      ),
                    );
                  }}
                >
                  <label className="grow">
                    Rechercher un article
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Robe, bleu, REF-0001…"
                      maxLength={120}
                    />
                  </label>
                  <button disabled={busy}>Rechercher</button>
                </form>
                <p className="muted">
                  {products.length} articles affichés · Affinez la recherche pour trouver votre
                  modèle.
                </p>
                <div className="product-grid">
                  {products.map((p) => (
                    <article className="panel product" key={p.ref}>
                      <div className="product-tag">{p.family}</div>
                      <h2>{p.model}</h2>
                      <p>
                        {p.color} · Taille {p.size}
                      </p>
                      <small>
                        {p.material} · {p.ref}
                      </small>
                      <div className="product-price">
                        <strong>{money(p.promotion?.priceCentimes ?? p.priceCentimes)}</strong>
                        {p.promotion && (
                          <>
                            <del>{money(p.priceCentimes)}</del>
                            <span className="promo">Promotion</span>
                          </>
                        )}
                      </div>
                      <p className="muted">{p.stock} en stock</p>
                      <button
                        disabled={
                          !profile ||
                          busy ||
                          (items.find((i) => i.ref === p.ref)?.quantity ?? 0) >=
                            Math.min(p.stock, 20)
                        }
                        onClick={() =>
                          void editItem(
                            p.ref,
                            (items.find((i) => i.ref === p.ref)?.quantity ?? 0) + 1,
                          )
                        }
                      >
                        Ajouter au panier
                      </button>
                    </article>
                  ))}
                </div>
                {!products.length && (
                  <p className="panel">Aucun article disponible ne correspond à cette recherche.</p>
                )}
              </section>
            </div>
            {profile && (
              <section className="order-section">
                <h2>Vos commandes dans Kenza</h2>
                <OrderList orders={orders} />
              </section>
            )}
          </>
        )}
        {mode === 'merchant' &&
          (!merchant ? (
            <section className="panel login">
              <h2>Connexion commerçant</h2>
              <p>Utilisez les identifiants configurés pour votre boutique.</p>
              <form
                onSubmit={(e) =>
                  submit(e, async (d) => {
                    await api('/merchant/login', {
                      email: String(d.get('email')),
                      password: String(d.get('password')),
                    });
                    await refreshMerchant();
                  })
                }
              >
                <label>
                  Adresse e-mail
                  <input type="email" name="email" autoComplete="username" required />
                </label>
                <label>
                  Mot de passe
                  <input type="password" name="password" autoComplete="current-password" required />
                </label>
                <button disabled={busy}>Se connecter</button>
              </form>
            </section>
          ) : (
            <>
              <div className="merchant-toolbar">
                <p>
                  {orders.length} commande(s) Kenza affichée(s) · 100 dernières au maximum. Les
                  commandes historiques sont exclues.
                </p>
                <button disabled={busy} onClick={() => void action(refreshMerchant)}>
                  Actualiser
                </button>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      await api('/merchant/logout', {});
                      setMerchant(false);
                      setOrders([]);
                    })
                  }
                >
                  Déconnexion
                </button>
              </div>
              <OrderList orders={orders} />
              <MerchantConversations />
              <MerchantFollowups />
            </>
          ))}
      </main>
    </div>
  );
}

function OrderList({ orders }: { orders: Order[] }) {
  return orders.length ? (
    <div className="order-grid">
      {orders.map((o) => (
        <article className="panel order" key={o.id}>
          <div>
            <span className="promo">Confirmée</span>
            <strong>{money(o.total_centimes)}</strong>
          </div>
          <h3>{o.customer_name || 'Votre commande'}</h3>
          <p>{new Date(o.created_at).toLocaleString('fr-FR')}</p>
          <small className="order-id">{o.id}</small>
          {o.lines?.map((l) => (
            <p key={l.ref}>
              {l.quantity} × {l.model} · {l.size} — {money(l.unitCentimes * l.quantity)}
            </p>
          ))}
          {o.delivery_city && (
            <p>
              {o.fulfillment_method === 'pickup' ? 'Retrait' : 'Livraison'} · {o.delivery_city}
              <br />
              {o.delivery_address}
            </p>
          )}
          <p>{paymentLabel[o.payment_method] ?? o.payment_method} · encaissement non suivi</p>
        </article>
      ))}
    </div>
  ) : (
    <p className="panel muted">Aucune commande confirmée pour le moment.</p>
  );
}
