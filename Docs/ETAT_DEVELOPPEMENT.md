# État de développement — Kenza

Mise à jour : 18 septembre 2026, reprise après le commit `a30b1db` sur `master`.
Ce journal remplace l’ancien état qui présentait encore les agents comme absents. Lire également `PASSATION_CODEX.md` pour les décisions métier et `PLAN_DEVELOPPEMENT.md` pour le périmètre.

## Dernier jalon : supervision commerçant

- Le commit `a30b1db` contient le chat, les agents Conversation/Catalogue/Garde-fou/Escalade, la mémoire et le checkpointer PostgreSQL. Il comporte déjà la reprise humaine et la suspension du dialogue automatique.
- Cette reprise ajoute le tableau de bord avec conversations, commandes confirmées, montant des commandes, conversion après échange et transferts ouverts. Les 320 commandes historiques sont exclues des ventes Kenza.
- Le détail affiche le profil, le panier actuel, les préférences avec leur preuve et les dix dernières commandes Kenza. Les motifs et actions du journal sont traduits en français.
- Filtres : toutes les conversations, transferts ouverts, reprise humaine. Les listes sont limitées aux 100 dernières conversations et se rafraîchissent toutes les dix secondes lorsque l’onglet est visible.
- Le commerçant peut clôturer les transferts sans changer le mode de réponse, ou rendre la main à Kenza et résoudre les transferts ouverts.
- Réponse, changement de mode et journal sont transactionnels et utilisent le verrou conversationnel existant. Une conversation inconnue renvoie 404. Un identifiant UUID de réponse évite les doublons après une nouvelle tentative ; un même identifiant avec un autre contenu ou un autre client est rejeté.
- La supervision reste accessible lorsque les modèles ne sont pas configurés. L’accueil ne devient plus blanc si la sonde de santé renvoie une erreur inattendue.

Fichiers principaux : `apps/api/src/supervision.ts`, `packages/core/src/domain/supervision.ts`, `db/migrations/004_supervision.sql`, `apps/web/src/MerchantConversations.tsx`, `tests/supervision.test.ts`.

## Définition des indicateurs

Période : depuis le démarrage, sans filtre temporel. Une conversation correspond à un client ayant au moins un message utilisateur enregistré. Un client converti a au moins une commande `source=kenza`, `status=confirmed`, créée après son premier message. Plusieurs achats du même client comptent une seule conversion ; aucun message donne un taux non défini, affiché « — ».

Le montant total inclut la livraison des commandes confirmées. Il ne mesure pas les encaissements. Le parcours manuel et le parcours conversationnel partagent `source=kenza` : ces chiffres n’attribuent donc pas toute la vente à l’agent autonome. Les commandes antérieures au premier message ne comptent pas comme conversion.

## État par lot

| Lot | État réel |
| --- | --- |
| 1 — Socle | Implémenté et précédemment démarré sous Docker. Compilation locale valide ; Docker actuellement bloqué sur ce poste. |
| 2 — Données et métier | Migrations, import reproductible, catalogue, prix et livraison testés avec PostgreSQL embarqué. |
| 3 — Vente complète | Parcours manuel testé ; le chat prépare le panier et le devis, la confirmation exige le bouton explicite. Parcours LLM complet multilingue à revalider. |
| 4 — Agents et mémoire | Implémentés dans `a30b1db`. Test PostgreSQL de mémoire, reprise et isolation disponible mais non exécuté durant cette reprise. |
| 5 — Supervision | Complétée et testée via SQL embarqué, HTTP injecté et navigateur. Concurrence avec génération LLM à revalider sur PostgreSQL 16. |
| 6 — Relances et A/B | À réaliser : le worker ne fait toujours qu’un signal de santé. |
| 7 — Multimodal et négociation | À réaliser. Le plafond arithmétique existe ; aucune remise agentique, transcription ou recherche photo activée. |
| 8 — Livraison | Documentation actualisée ; validation intégrale, installation propre et vidéo restent à faire. |

## Vérifications de cette reprise

- `pnpm check` : TypeScript valide, 22 tests réussis, zéro échec, deux tests ignorés sans `TEST_DATABASE_URL` (agents persistants et concurrence checkout).
- `pnpm build` : compilation web et serveurs réussie.
- Nouveau test de supervision : migrations réelles avec PGlite, exclusion des commandes historiques, conversion unique par client et date du premier message, session commerçant obligatoire, refus d’une session client, CSRF, 404, filtres, absence de doublons, conflits d’identifiant, clôture sans restitution, restitution, annulation transactionnelle sur échec du journal.
- Test agents PostgreSQL étendu : conflit du verrou avec une action commerçant, absence d’appels modèle en mode humain, reprise après restitution et résolution des transferts. NON EXÉCUTÉ ici faute de moteur PostgreSQL accessible.
- Navigateur : connexion, contexte client/panier, réponse commerçant, clôture du transfert et retour à Kenza vérifiés via la vraie interface et API, sur une base PGlite isolée en mémoire avec sessions Redis simulées. Aucune commande ni donnée de la boutique Docker n’a été modifiée. Ce contrôle ne valide pas le LLM ni Redis réel.
- Affichage inspecté sur bureau et à 390 px ; largeur DOM 375 px, pas de débordement horizontal. Une réponse d’erreur de la sonde de santé ne fait plus disparaître l’accueil.

Les validations antérieures consignaient le démarrage des cinq services, les appels texte GPT-5.5/GPT-4.1 et embeddings, ainsi que le test checkout concurrent sur PostgreSQL 16. Elles n’ont pas été répétées avec succès sur ce poste durant cette reprise.

## Blocage Docker constaté

Docker Desktop a été démarré, mais son backend échoue : `initializing Inference manager ... dockerInference ... The file cannot be accessed by the system.` Le journal de démarrage confirme l’arrêt des moteurs. Les commandes `docker compose up -d --build` et `docker info` sont restées sans réponse puis ont été interrompues. Aucun reset, aucune suppression des données Docker ni modification de ses fichiers internes n’a été effectuée.

Les clés LLM et identifiants restent dans `.env` ignoré par Git ; ne pas les afficher. Les noms de modèles déjà fournis sont conservés.

## Couverture à revalider avant livraison

| Exigence | Preuve disponible / travail restant |
| --- | --- |
| EX-01 dialogue jusqu’à commande | Implémentation présente ; scénario LLM réel complet à rejouer. |
| EX-02 outils catalogue/stock | Outils SQL testés, raccordement agent présent ; appels LLM à rejouer. |
| EX-03 commande en base/tableau de bord | Achat et indicateurs testés sur PostgreSQL embarqué ; revalidation Docker à faire. |
| EX-04 mémoire deuxième contact | Persistance et test d’intégration présents, test PostgreSQL ignoré ici. |
| EX-05 relance autonome | Non implémentée. |
| EX-06 transfert humain | Routes et parcours commerçant validés ; concurrence avec agent à rejouer. |
| EX-07 tableau de bord | Conversations, commandes, conversion et transferts implémentés et testés. |
| EX-08 français/arabe/darija | Prompts et réponses localisées présents ; évaluation réelle multilingue restante. |
| Bonus vocal / photo / négociation / A/B | Non terminés. |

## Prochaine action concrète

1. Rétablir le moteur Docker puis lancer `docker compose up -d --build` pour appliquer notamment `004_supervision.sql`.
2. Exécuter les tests avec `TEST_DATABASE_URL` vers PostgreSQL 16, puis rejouer chat → devis → bouton confirmation → commande commerçant et transfert/restitution avec les modèles configurés.
3. Réaliser le lot 6 : relance BullMQ unique à dernier message client + 30 minutes, contrôle de fraîcheur et d’éligibilité au moment de l’envoi, annulation achat/refus/reprise humaine, variante A/B persistante et attribution documentée.
4. Poursuivre vocal, photo et négociation, puis évaluation multilingue et livraison.

Les modifications de cette reprise ne sont pas commitées ni publiées. Le PDF original et le ZIP restent non suivis ; ne pas les inclure aveuglément.
