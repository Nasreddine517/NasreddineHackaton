# État de développement — Kenza

Mise à jour : 18 septembre 2026, 11h40 — reprise après commit `c40799c` sur `master`.

## Dernier jalon : négociation encadrée activée

- Commit `c40799c` : supervision commerçant, relances BullMQ, A/B testing complets et commitées.
- Cette reprise active la négociation encadrée (discountPct 0-10 dans le Plan LLM, plafond Math.min côté serveur, quoteUnitPrice avec discountPercent, escalade discount_limit si > 10%).
- TypeScript valide (zéro erreur). Tests complets en cours de revalidation.

## Docker — état vérifié à 11h28

Cinq services healthy sur `docker compose ps` :
- `kenza-web` : http://localhost:8080
- `kenza-api` : healthy, migrations 001–005 appliquées, seed 80 produits / 120 clients / 320 commandes historiques.
- `kenza-postgres` : 127.0.0.1:15432, 24 tables dont `followups` et `followup_assignments`.
- `kenza-redis` : 127.0.0.1:6379
- `kenza-worker` : **"Kenza worker ready: durable follow-ups enabled."** BullMQ actif avec modèles configurés.

## État par lot

| Lot | État réel |
| --- | --- |
| 1 — Socle | Implémenté, démarré, vérifié. |
| 2 — Données et métier | Migrations 001–005 appliquées, seed reproductible sans doublons. |
| 3 — Vente complète | Parcours manuel testé. Parcours LLM complet à rejouer en direct. |
| 4 — Agents et mémoire | Implémentés et testés sur PostgreSQL 16 réel (ok 1 agents.test). |
| 5 — Supervision | Complétée, testée SQL et navigateur, commitée. |
| 6 — Relances et A/B | Implémentés et testés sur PostgreSQL 16 + Redis réels (ok 4 et ok 5 followups.test). |
| 7 — Multimodal et négociation | Négociation encadrée : code complet, TypeScript valide, tests en cours. Vocal et photo : à faire. |
| 8 — Livraison | README mis à jour. Validation intégrale, vidéo et installation propre restent à faire. |

## Vérifications de cette session (18 sept., session 2)

- `pnpm typecheck` : valide.
- Tests sur PostgreSQL Docker réel + Redis (TEST_DATABASE_URL + TEST_REDIS_URL) :
  - ok 1 — agents persistants, garde-fou, mémoire, isolation, idempotence, reprise humaine
  - ok 2 — checkout : prix, propriété, quantités, confirmation explicite
  - ok 3 — checkout concurrent dernier article et double confirmation
  - ok 4 — relances : échéance exacte, invalidation, idempotence, garde et attribution 24h
  - ok 5 — BullMQ : job persistant après redémarrage, message unique
  - ok 6 — supervision : métriques SQL, routes protégées, transfert atomique, anti-doublon
  - **6/6 tests passés, 0 échec.**

## Couverture à revalider avant livraison

| Exigence | État |
| --- | --- |
| EX-01 dialogue jusqu'à commande | Tests unitaires OK ; parcours LLM réel à rejouer dans le navigateur. |
| EX-02 outils catalogue/stock | Outils SQL testés, raccordement agent validé en test. |
| EX-03 commande en base/tableau de bord | Testé sur PostgreSQL embarqué et Docker. |
| EX-04 mémoire deuxième contact | ok 1 agents.test sur PostgreSQL 16. |
| EX-05 relance autonome | ok 4 et ok 5 sur PostgreSQL 16 + Redis. Worker Docker actif. |
| EX-06 transfert humain | ok 1 et ok 6 ; parcours navigateur vérifié. |
| EX-07 tableau de bord | Implémenté et testé. |
| EX-08 français/arabe/darija | Prompts localisés présents ; évaluation réelle multilingue à faire. |
| Bonus négociation | Code complet, discountPct 0-10, plafond serveur, escalade discount_limit. Validation LLM à faire. |
| Bonus relances / A/B | Implémentés et testés (voir ci-dessus). |
| Bonus vocal / photo | Non implémentés. |

## Prochaine action concrète

1. Rebuild Docker api/worker avec le nouveau code (négociation), redémarrer.
2. Rejouer le parcours complet LLM dans le navigateur : chat → devis avec remise → bouton confirmation → commande → tableau de bord.
3. Tester l'escalade discount_limit : demander > 10% et vérifier le transfert.
4. Si temps disponible : vocal (tester l'endpoint Azure pour transcription audio).
5. Mettre à jour README, enregistrer la vidéo 2 min, push final.

## Blocages résolus

- Docker précédemment bloqué : maintenant opérationnel, cinq services healthy.
- Négociation précédemment désactivée dans le prompt : maintenant active avec plafond serveur.

## Configuration nécessaire (sans valeurs secrètes)

`.env` local avec : `LLM_URL`, `LLM_API_KEY`, `LLM_MODEL`, `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_API_VERSION=2024-12-01-preview`, `AZURE_OPENAI_DEPLOYMENT_NAME=gpt-4.1`, `FOLLOWUP_DELAY_MS=1800000`, `MERCHANT_EMAIL`, `MERCHANT_PASSWORD`.
