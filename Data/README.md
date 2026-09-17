# Données Kenza

`jeu-de-donnees-sujet-02-kenza.zip` est l’archive originale fournie par les organisateurs. `seed/` contient les neuf fichiers métier extraits de cette archive sans modifier leur contenu.

L’import utilise les six CSV et les exemples JSONL. Les fichiers Markdown restent les références métier, avec les décisions explicites du propriétaire consignées dans `Docs/PLAN_DEVELOPPEMENT.md`.

L’import est transactionnel et enregistré par empreinte. Un redémarrage ne réinitialise pas les stocks et ne réimporte pas les commandes historiques. Si le corpus change après l’import, une migration explicite sera nécessaire.

Les conversations d’exemple ne sont pas une source de prix, de stock ou de tarif de livraison. Leurs chiffres peuvent différer des tables ; ils ne doivent pas être présentés comme des données actuelles.
