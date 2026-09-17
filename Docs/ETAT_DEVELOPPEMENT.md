# État de développement — Kenza

Dernière mise à jour : 18 septembre 2026. Lire ce journal avec `PASSATION_CODEX.md` et `PLAN_DEVELOPPEMENT.md`, puis vérifier l’état Git réel.

## Avancement

| Lot | État réel |
| --- | --- |
| 1 — Socle | Implémenté ; compilation Node 20 dans Docker, cinq services démarrés, santé API et WebSocket vérifiés. |
| 2 — Données et métier | Import, schéma, recherche catalogue, prix et livraison implémentés ; tests embarqués réussis et import/réimport vérifiés sur PostgreSQL 16 Docker. Les tests métier complets en concurrence restent à ajouter avec les commandes. |
| 3 — Vente complète | À réaliser : profils de démonstration, panier persistant, confirmation transactionnelle, commandes et écrans opérationnels. |
| 4 — Agents et mémoire | Clients LLM configurés et premiers appels texte réels validés. Orchestration et mémoire agentique à réaliser. |
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
- `docker-compose.yml` : cinq services démarrés, volumes PostgreSQL/Redis, Redis AOF, dépendances de santé. Port PostgreSQL hôte 15432 pour éviter le refus Windows sur 5432.
- `.env.example` et `.env` local : accès LLM configurés ; compte commerçant encore à configurer. `.env` et les notes locales `Docs/API's` sont ignorés par Git ; ne jamais en afficher les valeurs.
- `packages/core/src/llm/clients.ts` : SDK officiel OpenAI, client v1 principal, client Azure séparé et client embeddings. Pas de fournisseur de secours implicite, journalisation SDK désactivée et erreurs restreintes à des codes non sensibles.
- `scripts/check-models.ts` / `pnpm models:check` : diagnostics réels opt-in, trois requêtes courtes avec texte fictif, sans données client.
- Les trois diagnostics ont aussi réussi depuis le conteneur API Node.js 20 après reconstruction et injection de la configuration Docker.

## Vérifications effectuées

- `pnpm check` : TypeScript valide et **19 tests réussis**, dont les routes SDK, l’authentification distincte Azure, la version d’API, les dimensions d’embeddings et l’absence de secrets dans les erreurs.
- `pnpm build` : construction web et serveurs réussie.
- `pnpm audit --prod` : aucune vulnérabilité connue signalée après correction des versions initiales.
- `docker compose config --quiet` : configuration Compose valide.
- `pnpm dlx pnpm@10.26.1 install --lockfile-only --frozen-lockfile --ignore-scripts` : compatibilité du lockfile vérifiée avec la version pnpm du Dockerfile.
- Tests SQL avec PGlite : application et réapplication des migrations, import des 80 produits / 120 clients / 320 commandes / 449 lignes, absence de réimport et préservation du stock modifié.
- Tests métier : plafond de 10 %, arrondi conservateur en centimes, priorité et dates des promotions, conditions inconnues refusées, stock nul, frais et modalités de livraison, ville absente, recherche SQL paramétrée.
- API : échec d’une dépendance renvoie 503 sans fuite du contenu de l’exception ; liveness reste distincte de readiness.
- Navigateur : accueil inspecté, WebSocket connecté, services absents signalés. À 390 px, largeur du contenu 386 px, pas de débordement horizontal constaté.

Vérification Docker complémentaire : build réussi sous Node 20.19.5 et pnpm 10.26.1 ; migrations et import exécutés sur PostgreSQL 16 ; les 80 produits, 120 clients, 320 commandes et 449 lignes sont présents. Une seconde exécution du seed ne réimporte pas les données. `http://127.0.0.1:8080/` et `/api/health/ready` répondent HTTP 200, avec PostgreSQL, Redis et worker disponibles.

Limites : PGlite est un PostgreSQL embarqué de test, pas le service PostgreSQL 16 cible. L’adaptateur de test neutralise les verrous consultatifs, sans simuler la concurrence ; leurs scénarios concurrents doivent être vérifiés sur Docker avec le futur parcours de commande. Les tests unitaires locaux utilisent Node 24 ; la compilation et l’exécution des services sont maintenant vérifiées sous Node 20 Docker.

## Blocages et éléments à ne pas inventer

1. **Docker Desktop : blocage levé.** Le moteur est devenu accessible à la reprise sans modification de ses fichiers internes ni reset. Windows refusait ensuite l’exposition de PostgreSQL sur 5432 ; le port hôte a été déplacé à 15432. Les cinq services ont démarré. Ne pas attribuer la résolution du premier problème à une réparation qui n’a pas été faite.
2. **LLM : accès validés.** GPT-5.5 utilise `LLM_*` et une base v1 ; GPT-4.1 utilise `AZURE_OPENAI_*`, version `2024-12-01-preview`, déploiement `gpt-4.1`, plafond 16384. Les valeurs déjà saisies sous `SECONDARY_LLM_*` ont été conservées et renommées localement, sans affichage. Les trois appels réels ont réussi : texte GPT-5.5, texte GPT-4.1, embedding `embedder-small-3` de 512 dimensions. L’audio, l’image et les appels d’outils restent à vérifier.
3. Le README source et les données de démonstration contiennent des chiffres de conversation différents des tables métier. Le catalogue et la grille restent les seules sources opérationnelles des prix, stocks et frais.

## Prochaines actions

1. Garder les cinq services opérationnels et poursuivre les tests de persistance et de concurrence à mesure que le parcours de vente est ajouté.
2. Poursuivre le lot 3 : modèle de panier, mise à jour et devis fiables, confirmation transactionnelle avec idempotence et gestion du dernier article en stock ; tests avant branchement conversationnel.
3. Protéger l’accès commerçant avant toute route de commandes privées. Définir les routes et sessions du simulateur.
4. Utiliser les accès déjà configurés pour développer les outils LangGraph et vérifier les capacités image/audio, sans redemander les clés ni changer les noms de modèles fournis.
5. Garder le README et ce journal synchronisés, sans marquer une exigence terminée sur la seule présence de fichiers.

## Reprise pratique

L’instance Docker est accessible sur `http://127.0.0.1:8080`. Des serveurs de développement ont également été démarrés : API `http://127.0.0.1:3000`, interface `http://127.0.0.1:5173`. Vérifier s’ils tournent encore avant de les relancer. La page d’accueil est une base visuelle de développement, pas l’application commerciale terminée.

Le dépôt d’origine contenait uniquement le commit `d19b592` publié sur GitHub. Vérifier les commits ajoutés depuis et les fichiers non suivis ; le PDF original et le ZIP ne doivent pas être ajoutés aveuglément avec les fichiers applicatifs. Aucune publication des changements applicatifs n’a été effectuée à la rédaction de ce journal.
