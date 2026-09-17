# Kenza — Passation à un nouveau Codex

Ce document est le contexte de reprise du projet. Lis-le intégralement avant de modifier l’application. Il rassemble les décisions du propriétaire du projet, les exigences du sujet et l’état constaté lors de sa rédaction. Une instruction plus récente du propriétaire prévaut sur ce document.

## 1. Mission et méthode de reprise

Tu reprends le développement de Kenza, un agent commercial conversationnel pour une boutique marocaine. Le propriétaire souhaite un produit complet, fiable et soigné pour le hackathon ESISA × Numeos Technology, sujet 02.

Travaille minutieusement : comprends le travail existant, conserve ce qui fonctionne et continue exactement au point où le développement s’est arrêté. Ne recrée pas le projet si du code existe déjà. Ne considère pas cette passation comme une preuve que les fonctionnalités sont réalisées.

À chaque reprise :

1. Lire les éventuels `AGENTS.md` applicables, ce document et le README.
2. Examiner `git status`, la branche courante, les derniers commits et les différences non commitées. Ne pas écraser le travail de l’utilisateur ou d’un autre agent.
3. Lire le cahier des charges et les règles des données ; ne pas se contenter du README.
4. Examiner le code, les migrations, les fichiers Docker, la configuration et les tests présents. Ne jamais afficher les secrets.
5. Identifier ce qui est réellement fonctionnel, partiel, non testé ou absent. Une case cochée dans un document n’est pas une vérification.
6. Exécuter les vérifications pertinentes pour la partie à reprendre, puis annoncer brièvement le point de reprise et poursuivre le travail demandé.
7. Ne pas redemander les décisions déjà fixées ci-dessous. Poser une question seulement si un obstacle matériel ou une ambiguïté importante subsiste ; continuer les tâches indépendantes entre-temps.

Communiquer en français, clairement et sans exagérer l’avancement. Le propriétaire veut comprendre le produit. Les fonctionnalités simulées, les tests non exécutés et les limitations doivent être identifiés comme tels.

## 2. Emplacement et état initial vérifié

- Dossier de travail : `C:\wrks\NasreddineHackaton`.
- Dépôt : https://github.com/Nasreddine517/NasreddineHackaton
- Branche lors de cette passation : `master`.
- Commit vérifié : `d19b592` — `docs: present Kenza scope and target architecture`.
- Ce commit contient uniquement le README et a été publié sur GitHub.
- Aucun code applicatif, schéma de base, test, fichier Docker ou configuration LLM n’avait encore été créé lors de cette vérification.
- Aucun projet d’amorçage n’a été obtenu. Le propriétaire a choisi de construire le socle en respectant les technologies du sujet.
- `Docs/`, `Data/` et `tmp/` étaient non suivis par Git. Ne pas présumer qu’ils sont disponibles dans un clone distant.
- Cette passation est créée localement après le commit ci-dessus. Sa présence sur GitHub ne doit pas être supposée.

**Ces informations sont un instantané du 17 septembre 2026.** Si le dépôt a avancé, partir de son état réel, pas de cet état initial.

Sources locales :

- `Docs/Cahier-des-charges-Sujet-02-Kenza (1).pdf` : neuf pages, source principale des exigences.
- `Data/jeu-de-donnees-sujet-02-kenza.zip` : données métier et politiques commerciales.
- `README.md` : présentation professionnelle du projet, architecture cible et périmètre.
- `tmp/pdfs/` : rendus de lecture du PDF ; fichiers de travail, pas des livrables applicatifs.

Le README publié précède plusieurs décisions finales. Il faut notamment actualiser les passages sur la recherche visuelle, les remises, les horaires, les relances et l’identité des utilisateurs.

## 3. Produit et interfaces validés

Kenza sera une **application web** avec deux espaces reliés au même backend :

### Espace client

- Chat web en temps réel : texte, enregistrement ou dépôt de vocal, dépôt de photo.
- Historique de la conversation, suggestions produit et récapitulatif du panier.
- Conversation naturelle en français, arabe et darija, y compris darija latine, fautes et mélanges de langues.
- Recherche, modification du panier et confirmation de commande dans la conversation.
- Accès sans inscription pour la démonstration : sélectionner un client fictif fourni ou créer un profil de démonstration avec un identifiant stable.
- Cet identifiant relie les conversations, la mémoire et les commandes du même client.
- La sélection libre d’un profil est une fonction du simulateur, pas un mécanisme d’identification sûr pour une boutique publique.

### Espace commerçant

- Un compte commerçant unique, protégé par une connexion. Cette décision a été explicitement acceptée.
- Tableau de bord : conversations, commandes, ventes réalisées par Kenza, taux de conversion, file d’escalade.
- Détail d’une conversation, panier, contexte client, historique et motif de transfert.
- Reprise humaine dans l’interface, suspension des réponses automatiques, clôture ou restitution à Kenza.
- Relances prévues, envoyées ou annulées et résultats des variantes A/B.
- Journal d’actions métier compréhensible ; les détails techniques peuvent être réservés à une vue de démonstration.
- Protéger les endpoints du commerçant côté serveur, pas seulement masquer les écrans.

Il s’agit d’une seule application avec deux espaces, pas de deux produits indépendants. Pas de gestion complexe de rôles ni de multiples boutiques.

## 4. Exigences MVP obligatoires

| Référence | Résultat attendu |
| --- | --- |
| EX-01 | Conversation de bout en bout, du premier message à la commande, via le chat web. |
| EX-02 | Catalogue et stock consultés avec de vrais appels d’outils ; ne pas recopier le catalogue dans le prompt comme source opérationnelle. |
| EX-03 | Commande effectivement créée en base et visible dans le tableau de bord. |
| EX-04 | Mémoire par client retrouvée lors d’un deuxième contact. |
| EX-05 | Relance automatique décidée et déclenchée par l’agent, démontrable en direct. |
| EX-06 | Transfert explicite à un humain avec le contexte de la conversation. |
| EX-07 | Tableau de bord avec conversations, conversion, commandes et escalades. |
| EX-08 | Compréhension et réponses en français, arabe et darija. |

Ces exigences doivent fonctionner sur de nouveaux messages, pas seulement sur un scénario préparé. La darija est obligatoire.

## 5. Décisions métier finales du propriétaire

### Images

Le catalogue n’a pas de colonne de photos. Le propriétaire a choisi **la reconnaissance des caractéristiques d’une photo et la proposition de produits similaires**.

Ne pas conditionner le démarrage à l’obtention de photos de référence. Extraire les caractéristiques visibles, chercher les produits dans le catalogue réel, puis vérifier les variantes et le stock. Ne pas prétendre avoir identifié exactement un article ni inventer une référence. Faire clarifier si nécessaire.

### Promotions et négociation

- Une promotion valide et applicable est prioritaire.
- Aucune remise supplémentaire ne se cumule avec cette promotion.
- Sans promotion applicable, Kenza peut proposer spontanément une remise si le client hésite, jusqu’à **10 % maximum**.
- Ce n’est pas une remise automatique de 10 % à chaque conversation : comprendre l’hésitation et rester dans le cadre commercial.
- Un contrôle déterministe côté serveur empêche un prix inférieur au plancher autorisé, même si le modèle ou le client le demande.
- Une remise dépassant les droits de l’agent déclenche une escalade. Le simple transfert n’autorise pas l’agent à accorder l’exception.

### Réponses et relances

- Les messages entrants doivent être traités immédiatement **24 h/24**.
- Le propriétaire a explicitement remplacé la règle de la FAQ qui prévoyait le traitement des messages nocturnes le lendemain. Ne pas réintroduire cette restriction.
- Pour un panier non finalisé dont le client cesse de répondre, programmer la relance **exactement 30 minutes après son dernier message**, y compris la nuit.
- Chaque nouveau message du client remet l’échéance à `dernier_message_client + 30 minutes`.
- Utiliser le message client comme origine du délai, pas la dernière réponse de Kenza.
- Une seule relance pour cet abandon. Ne pas créer une boucle automatique toutes les 30 minutes.
- Annuler si la commande est confirmée, si le client refuse les relances ou si un humain reprend le dossier ; réévaluer également le panier et le stock.
- Pas de restriction de relance entre 10 h et 20 h. L’ancienne proposition de délai journalier n’a pas été retenue.
- L’échéance est exacte ; une indisponibilité ou la latence de la file peut retarder l’envoi effectif. Ne pas promettre une garantie d’exécution temps réel absolue.
- Planifier via BullMQ sur Redis, exécuter via le worker. Pas de `setTimeout` en mémoire dans l’API.
- Vérifier l’éligibilité et la fraîcheur de l’échéance au moment de l’exécution pour neutraliser les tâches obsolètes et doublons.
- Un délai raccourci est possible uniquement en mode démonstration explicite ; le fonctionnement normal reste à 30 minutes.

Le délai fixe exprime la règle métier du propriétaire. L’agent reste responsable de l’éligibilité et du contenu contextualisé de la relance ; la file assure son exécution durable.

### Stock, livraison et commande

- Stock nul : annoncer la rupture et proposer une alternative disponible.
- Ne jamais promettre une date de réassort, même si `delai_reassort_jours` est renseigné.
- Frais et délais de livraison exclusivement issus de `livraison.csv`.
- Ville absente : escalade, aucune estimation.
- Paiement à la livraison seulement là où autorisé ; retrait selon la grille et les règles fournies.
- Recalculer les montants après changement de variante, quantité ou destination.
- Confirmation explicite avant création de commande.
- Recommandation de réalisation : panier sans réservation initiale, contrôle et décrémentation du stock dans la transaction de confirmation, protection contre les confirmations répétées. Adapter si un mécanisme équivalent existe déjà.
- Enregistrer le moyen de paiement ne signifie pas encaisser un paiement.
- Ne confirmer au client qu’une commande dont l’écriture en base a réussi.

### Escalade et demandes ambiguës

Transférer au commerçant : demande de remise excessive, facturation au nom d’une société, réclamation, litige, remboursement en espèces, demande hors catalogue, ville hors grille ou information métier non disponible nécessitant une décision humaine.

Pour un message ambigu, un vocal incertain ou plusieurs produits possibles, demander d’abord une clarification ciblée. Une rupture se traite normalement par proposition d’alternatives. Une question sans lien avec la boutique peut être recentrée sans escalade systématique.

En cas de transfert : prévenir le client, créer le dossier avec motif et contexte complet, suspendre les actions automatiques concernées, permettre la reprise humaine. Ne pas promettre un délai de réponse du commerçant non garanti.

Les informations d’échange ou d’avoir sous sept jours et de garantie viennent des politiques fournies. Le traitement complet des retours n’est pas une fonctionnalité à développer.

## 6. Les quatre bonus font partie du périmètre

Ne pas les réduire à un bonus unique « si le temps le permet » sans nouvelle décision du propriétaire. Les développer par étapes après un socle stable.

1. **Vocal** : recevoir ou enregistrer l’audio, transcrire, comprendre les demandes et les exécuter via les mêmes outils que le texte. Faire confirmer les éléments incertains. Rendre la transcription consultable. La réponse synthétisée en audio n’est pas prévue.
2. **Image** : extraction de caractéristiques et recherche de produits similaires, conformément à la décision ci-dessus.
3. **Négociation encadrée** : promotions prioritaires, remise possible hors promotion, plancher infranchissable par le modèle, escalade pour exception.
4. **A/B testing automatique des relances** : variantes contextualisées, attribution persistante et automatique, une variante par client dans un même test, suivi des réponses et commandes. Afficher les effectifs et résultats observés sans annoncer de supériorité statistique sur quelques essais. Définir et documenter la fenêtre d’attribution.

## 7. Architecture et technologies à respecter

Le propriétaire demande explicitement d’utiliser l’architecture et les technologies présentées dans le cahier des charges :

- React 18 + TypeScript + Vite pour le web.
- Node.js 20 + TypeScript + Fastify pour l’API.
- LangGraph (`@langchain/langgraph`) pour l’orchestration explicite.
- PostgreSQL 16 pour les données métier et le checkpointer persistant LangGraph.
- Redis 7 pour l’état conversationnel courant et les files.
- BullMQ et un worker dédié pour les relances.
- WebSocket entre le chat React et l’API.
- Docker Compose avec cinq services : `web`, `api`, `postgres`, `redis`, `worker`.
- Configuration documentée et lancement reproductible par `docker compose up` après renseignement des paramètres nécessaires.

Agents distincts : Conversation, Catalogue, Relance, Garde-fou, Escalade. Leurs responsabilités, leurs transitions et leurs outils doivent être lisibles. Un appel LLM unique avec cinq rôles énumérés dans un prompt ne remplit pas l’exigence.

La base et les outils métier restent la source de vérité. Le code doit contrôler les prix, quantités, stocks et permissions ; le prompt seul ne suffit pas. Conserver les traces d’outils et des justifications synthétiques, sans exposer de raisonnement interne du modèle.

Prévoir une mémoire isolée par client, des opérations de commande atomiques, l’idempotence des événements sensibles, une gestion visible des échecs et la reprise après redémarrage.

## 8. Accès aux modèles et secrets

Le propriétaire a reçu par email deux accès, désignés GPT-5.5 et GPT-4.1, avec pour chacun `LLM_URL`, `LLM_API_KEY` et l’identifiant de modèle.

- Il s’agit d’accès API, pas seulement d’une interface de discussion.
- Aucune valeur réelle n’a été confiée dans la conversation ni configurée lors de cette passation.
- Ne pas inventer les URLs, noms exacts de modèle ou capacités de l’endpoint.
- Prévoir une configuration côté serveur pouvant accueillir les deux accès ; ne pas imposer arbitrairement une répartition des modèles avant vérification.
- Tester les appels texte et les outils, puis les capacités image et audio effectivement exposées.
- Si la transcription ou la vision manque, identifier une solution compatible et ses contraintes ; ne pas prétendre que le bonus fonctionne avec une simulation.
- Ne pas engager de service payant sans accord du propriétaire.
- Préparer `.gitignore` et `.env.example` avant la configuration des clés. Pas de clé dans le navigateur, les logs, les captures, les commits ou le README.
- Demander au propriétaire de renseigner les secrets localement ; ne pas lui demander de les coller dans la conversation.

## 9. Jeu de données

L’archive contient le dossier `sujet-02-kenza/` avec :

| Fichier | Données |
| --- | --- |
| `catalogue.csv` | 80 références : modèle, famille, genre, couleur, taille, matière, saison, prix MAD, stock, délai indicatif de réassort, code-barres, poids. |
| `clients.csv` | 120 clients avec identifiant, ville, langue préférée et informations historiques. |
| `commandes.csv` | 320 commandes historiques. |
| `commandes-lignes.csv` | 449 lignes de commande. |
| `livraison.csv` | 12 entrées de villes avec frais, délai, paiement à la livraison et retrait. |
| `promotions.csv` | 12 promotions avec dates et conditions. |
| `conversations.jsonl` | Corpus annoncé de 40 conversations ; examiner la structure réelle avant utilisation. |
| `politique-commerciale.md` | Règles commerciales détaillées. |
| `faq-boutique.md` | Informations pratiques, avec exception d’horaires explicitement décidée par le propriétaire. |
| `README-jeux-de-donnees.md` | Description de plusieurs sujets ; seule la section Kenza concerne ce projet. |

Les données sont fictives. Ne pas présumer que des binaires audio ou des photos accompagnent les exemples de conversations. Vérifier leur contenu réel.

Importer les données sans doublons lors d’un redémarrage ou d’une réexécution du seed. Distinguer les commandes historiques des commandes créées par Kenza dans les indicateurs. Respecter les dates de promotions ; ne pas modifier silencieusement la date courante pour les rendre actives.

## 10. Périmètre exclu

- WhatsApp réel : non nécessaire, pas retenu actuellement. Le simulateur web est accepté sans perte de points.
- Paiement en ligne réel et intégration bancaire.
- Application desktop ou mobile native.
- Multi-boutiques et gestion complexe de rôles.
- Synthèse vocale des réponses.
- Gestion complète des retours et remboursements.

Ne pas ajouter ces travaux au détriment des exigences et des quatre bonus retenus.

## 11. Ordre de développement conseillé

Cette séquence s’applique seulement aux parties encore manquantes :

1. Mettre à jour le README avec les décisions finales ; préparer la configuration sûre et l’inventaire des capacités disponibles.
2. Créer le socle TypeScript, Docker Compose, migrations et import des données ; vérifier la communication entre services.
3. Réaliser une première tranche complète : chat → outils catalogue/stock → panier → livraison → confirmation → commande en base → tableau de bord.
4. Ajouter la mémoire persistante, les garde-fous, l’escalade et la reprise humaine ; protéger l’espace commerçant.
5. Réaliser les relances BullMQ à 30 minutes et leur gestion des annulations, reprises et doublons.
6. Compléter les quatre bonus, la qualité en darija, les indicateurs et les traces visibles.
7. Vérifier les scénarios imprévus, le lancement depuis un environnement propre et les instructions de livraison.

Construire des parcours fonctionnels successifs. Ne pas livrer seulement une interface avec des réponses ou des métriques fictives. Une interface soignée compte, mais 75 % de la note concernent la profondeur agentique, le fonctionnement réel et la fiabilité.

## 12. Validation attendue

Maintenir une matrice de couverture EX-01 à EX-08 et des quatre bonus. Vérifier notamment :

- Achat complet dans chacune des langues, dont des formulations imprévues en darija.
- Taille, quantité et ville modifiées sans perdre le panier.
- Rupture de stock, alternatives réelles et absence de promesse de réassort.
- Promotion applicable, absence de cumul, plafond de remise et tentatives de contournement.
- Ville hors grille et autres escalades avec contexte complet.
- Mémoire au deuxième contact et après redémarrage, sans fuite entre clients.
- Deux confirmations ne créant qu’une commande ; concurrence sur le dernier article disponible.
- Échec d’écriture ou d’outil sans fausse confirmation.
- Échéance de relance calculée sur le dernier message client, remise à zéro au nouveau message et neutralisation des anciennes tâches.
- Relance nocturne, relance unique pour l’abandon et annulation après achat/refus/reprise humaine.
- Tâche planifiée conservée après redémarrage et absence de double envoi.
- Vocal incertain ou photo ambiguë : clarification et respect des données.
- Attribution persistante des variantes A/B et métriques basées sur les événements réels.
- Accès commerçant protégé, affichage lisible sur mobile et prise en charge de l’écriture arabe.
- Démarrage Docker, migration/seed reproductibles et absence de secrets suivis par Git.

Utiliser des tests adaptés et une vérification réelle des parcours. Un test simulé ne prouve pas qu’un endpoint LLM externe ou un service Docker fonctionne : préciser les limites de ce qui a été exécuté.

## 13. Git et livraison

Le README initial a été demandé et publié par le propriétaire. Le push a d’abord échoué avec le compte `redalos`, puis réussi avec `Nasreddine517`.

Configuration locale utilisée : `credential.https://github.com.username = Nasreddine517`. Ne pas supprimer d’autres comptes ni afficher leurs identifiants secrets. Si un futur environnement n’a pas accès au dépôt, distinguer un problème d’authentification d’un problème de code.

Dans l’environnement Windows précédent, Git pouvait signaler une propriété douteuse du dossier. L’exception était appliquée à la commande avec `git -c safe.directory=C:/wrks/NasreddineHackaton ...`, sans désactiver globalement cette protection.

Ne pas effectuer de `git add .` aveugle : `Data/`, `Docs/`, fichiers temporaires et secrets éventuels doivent être examinés avant ajout. Respecter les autorisations de publication de la session en cours ; cette passation ne vaut pas autorisation de déployer ou de publier tous les fichiers.

Livrables du sujet : code complet, README utile, historique de commits lisible, Docker Compose et vidéo de deux minutes montrant les actions du système. Une clé API publiée est éliminatoire.

Grille : profondeur agentique 30 %, produit fonctionnel 25 %, fiabilité 20 %, qualité technique 15 %, pitch/vidéo 10 %.

Échéance inscrite dans le PDF : **samedi 19 septembre 2026 à 00 h 00**, soit la nuit du vendredi au samedi. Le fuseau n’est pas précisé. Ne pas confondre cette échéance avec le samedi soir ni supposer qu’elle a été prolongée.

## 14. Garder une passation exploitable

À chaque jalon significatif ou avant un changement d’agent, actualiser un journal de reprise local, par exemple `Docs/ETAT_DEVELOPPEMENT.md`, avec :

```text
Date et branche :
Dernier commit pertinent :
Objectif en cours :
Fonctionnalités réellement terminées :
Travail partiel et fichiers concernés :
Modifications non commitées à conserver :
Tests exécutés et résultats :
Vérifications non exécutées et raisons :
Erreurs ou obstacles observés :
Configuration nécessaire, sans valeurs secrètes :
Prochaine action concrète :
Décisions récentes du propriétaire :
```

Au moment de cette première passation, la prochaine action de développement serait l’actualisation du README puis la préparation du socle. **Ne lancer ce développement que lorsque le propriétaire le demande : la demande ayant créé ce document portait uniquement sur la préparation d’une passation avant de coder.**

Une fois chargé de continuer le développement, avancer jusqu’au résultat demandé, en conservant les décisions validées et en signalant précisément les obstacles qui nécessitent une intervention du propriétaire.
