# Plan de développement de Kenza

Chaque lot doit avoir un résultat observable, des vérifications consignées et une mise à jour de `ETAT_DEVELOPPEMENT.md`. Un fichier écrit n’est pas une fonctionnalité validée. Les tests bloqués sont indiqués séparément.

| Lot | Livrable | Critère de sortie |
| --- | --- | --- |
| 1 — Socle | Structure TypeScript, React, Fastify, worker, configuration et cinq services Docker | Compilation, tests de santé, interface ouverte, Compose valide ; démarrage des conteneurs vérifié lorsque le moteur est disponible. |
| 2 — Données et métier | Migrations, import reproductible, catalogue, stock, prix, promotions et livraison | Données importées sans doublons ; règles testées, y compris plancher de prix et villes hors grille. |
| 3 — Vente complète | Client de démonstration, chat WebSocket, panier et commande affichée côté commerçant | Une commande réelle, cohérente, sans double enregistrement. Le dialogue autonome dépend du lot 4. |
| 4 — Agents et mémoire | LangGraph, outils, gardes-fous, accès LLM réel et mémoire PostgreSQL par client | Conversation autonome, traces d’outils et continuité après redémarrage. |
| 5 — Supervision | Compte commerçant, escalade contextualisée, reprise humaine | Accès serveur protégé ; transfert et arrêt des réponses automatiques vérifiés. |
| 6 — Relances et A/B | BullMQ, échéance à 30 minutes, éligibilité, variantes et indicateurs | Persistance après redémarrage, annulation correcte, pas de doublon, métriques réelles. |
| 7 — Multimodal et négociation | Audio, image vers produits similaires, initiative commerciale encadrée | Parcours réels avec audio/image ; aucun cumul promo/remise ; incertitudes clarifiées. |
| 8 — Livraison | Tests transverses en darija, interface finale, documentation et préparation vidéo | Matrice EX-01 à EX-08 et quatre bonus renseignée ; installation vérifiée depuis une base propre. |

## Décisions définitives

- Application web, chat simulateur ; pas de WhatsApp réel prévu actuellement.
- Client sans inscription : profil fictif sélectionné ou créé, avec identifiant stable.
- Un seul compte commerçant avec connexion ; pas de gestion multi-rôles.
- Messages entrants traités immédiatement, 24 h/24.
- Relance unique pour un abandon, à dernier message client + 30 minutes, même la nuit ; remise à zéro sur nouveau message et annulation après commande, refus ou reprise humaine.
- Une promotion valide est prioritaire, sans cumul. Hors promotion, remise possible sur hésitation, de 0 à 10 %, plafonnée dans le code.
- Une photo sert à proposer des produits similaires ; aucune promesse d’identification exacte.
- MVP complet et quatre bonus inclus. Les capacités des endpoints fournis doivent être testées avant d’annoncer leur prise en charge.

Les lots sont des jalons de réalisation, pas des restrictions empêchant de partager des composants. La protection serveur des données privées doit précéder leur exposition, même si la finition de l’interface commerçant intervient plus tard.

## Références techniques

- [Fastify : TypeScript](https://fastify.dev/docs/latest/Reference/TypeScript/)
- [BullMQ : tâches différées](https://docs.bullmq.io/guide/jobs/delayed)
- [LangGraph : persistance](https://docs.langchain.com/oss/javascript/langgraph/persistence)
