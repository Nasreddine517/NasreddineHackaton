# État de développement — Kenza

Dernière mise à jour : 17 septembre 2026. Lire ce journal avec `PASSATION_CODEX.md` et `PLAN_DEVELOPPEMENT.md`, puis vérifier l’état Git réel.

## Avancement

| Lot | État réel |
| --- | --- |
| 1 — Socle | Implémenté ; compilation, santé API et WebSocket local vérifiés. Démarrage complet des conteneurs bloqué par Docker Desktop. |
| 2 — Données et métier | Import, schéma, recherche catalogue, prix et livraison implémentés ; tests PostgreSQL embarqué réussis. Vérification sur PostgreSQL 16 Docker restante. |
| 3 — Vente complète | À réaliser : profils de démonstration, panier persistant, confirmation transactionnelle, commandes et écrans opérationnels. |
| 4 — Agents et mémoire | À réaliser ; les identifiants LLM ne sont pas encore renseignés. |
| 5 — Supervision | À réaliser ; ne pas exposer de données commerçant avant protection serveur. |
| 6 — Relances et A/B | À réaliser. Le worker actuel ne fait qu’émettre un signal de santé. |
| 7 — Multimodal et négociation | À réaliser. Le plafond arithmétique est testé, pas encore la décision commerciale autonome. |
| 8 — Livraison | À réaliser. |

## Ce qui existe

- `apps/web` : React 18, Vite, première direction visuelle et état réel des services. Aucun faux échange, faux chiffre de vente ou bouton d’achat présenté comme fonctionnel.
- `apps/api` : Fastify, liveness/readiness, état du socle, connexion WebSocket. Le socket annonce explicitement que la conversation n’est pas encore disponible.
- `apps/worker` : vérification PostgreSQL et signal de santé Redis avec expiration. Ce minuteur est seulement une sonde de santé, pas une relance commerciale.
- `packages/core` : validation de configuration, connexions, migrations, import et outils métier.
- `db/migrations/001_catalogue.sql` : catalogue, clients, livraison, promotions, commandes historiques, lignes et exemples de conversations.
- `Data/seed` : neuf fichiers extraits du ZIP original, contenus inchangés.
- `docker-compose.yml` : cinq services, volumes PostgreSQL/Redis, Redis AOF, dépendances de santé. Aucun conteneur Kenza n’a encore été démarré avec succès sur cette machine.
- `.env.example` et `.env` local créé s’il était absent : les accès LLM et commerçant restent à renseigner. `.env` est ignoré par Git ; ne jamais en afficher les valeurs.

## Vérifications effectuées

- `pnpm check` : TypeScript valide et **14 tests réussis**, après mise à jour des dépendances.
- `pnpm build` : construction web et serveurs réussie.
- `pnpm audit --prod` : aucune vulnérabilité connue signalée après correction des versions initiales.
- `docker compose config --quiet` : configuration Compose valide.
- `pnpm dlx pnpm@10.26.1 install --lockfile-only --frozen-lockfile --ignore-scripts` : compatibilité du lockfile vérifiée avec la version pnpm du Dockerfile.
- Tests SQL avec PGlite : application et réapplication des migrations, import des 80 produits / 120 clients / 320 commandes / 449 lignes, absence de réimport et préservation du stock modifié.
- Tests métier : plafond de 10 %, arrondi conservateur en centimes, priorité et dates des promotions, conditions inconnues refusées, stock nul, frais et modalités de livraison, ville absente, recherche SQL paramétrée.
- API : échec d’une dépendance renvoie 503 sans fuite du contenu de l’exception ; liveness reste distincte de readiness.
- Navigateur : accueil inspecté, WebSocket connecté, services absents signalés. À 390 px, largeur du contenu 386 px, pas de débordement horizontal constaté.

Limites : PGlite est un PostgreSQL embarqué de test, pas le service PostgreSQL 16 cible. L’adaptateur de test neutralise les verrous consultatifs, sans simuler la concurrence ; leur comportement doit être vérifié sur Docker. Les tests locaux utilisent Node 24 disponible dans l’environnement ; le build cible Node 20, mais son exécution en conteneur reste à vérifier.

## Blocages et éléments à ne pas inventer

1. **Docker Desktop** échoue avant le démarrage du moteur Linux. Son journal indique : `initializing Inference manager ... dockerInference ... The file cannot be accessed by the system`. Les tentatives de démarrage par l’exécutable officiel puis `docker desktop start` n’ont pas rendu le moteur accessible. Aucun reset, suppression de volume ou modification des fichiers internes Docker n’a été effectué. Une question a été envoyée au propriétaire pour vérifier le démarrage de son côté.
2. **LLM** : le propriétaire a les accès GPT-5.5 et GPT-4.1 par email, mais les valeurs n’ont pas encore été saisies dans `.env`. Aucun appel réel, test audio ou test image n’a été effectué.
3. Le README source et les données de démonstration contiennent des chiffres de conversation différents des tables métier. Le catalogue et la grille restent les seules sources opérationnelles des prix, stocks et frais.

## Prochaines actions

1. Vérifier le statut Docker sans toucher aux données utilisateur ; une fois le moteur disponible, exécuter `docker compose up --build`, contrôler les cinq services et l’import au redémarrage.
2. Poursuivre le lot 3 : modèle de panier, mise à jour et devis fiables, confirmation transactionnelle avec idempotence et gestion du dernier article en stock ; tests avant branchement conversationnel.
3. Protéger l’accès commerçant avant toute route de commandes privées. Définir les routes et sessions du simulateur.
4. Demander la saisie locale des paramètres Numeos uniquement lorsqu’elle est nécessaire, puis tester réellement l’endpoint avant LangGraph et multimodal.
5. Garder le README et ce journal synchronisés, sans marquer une exigence terminée sur la seule présence de fichiers.

## Reprise pratique

Les serveurs locaux ont été démarrés pendant cette session : API `http://127.0.0.1:3000`, interface `http://127.0.0.1:5173`. Vérifier s’ils tournent encore avant de les relancer. La page d’accueil est une base visuelle de développement, pas l’application commerciale terminée.

Le dépôt d’origine contenait uniquement le commit `d19b592` publié sur GitHub. Vérifier les commits ajoutés depuis et les fichiers non suivis ; le PDF original et le ZIP ne doivent pas être ajoutés aveuglément avec les fichiers applicatifs. Aucune publication des changements applicatifs n’a été effectuée à la rédaction de ce journal.
