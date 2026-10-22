Infinite Tower CO-OP — serveur de combat v0.2.0

Fichiers pour le dépôt GitHub infinite-tower-server :
  server.js      Nouveau moteur CO-OP (remplace l'ancien)
  package.json   Dépendance ws et commande npm start

Déploiement : Render Web Service Free, Build: npm install, Start: node server.js.
Le code est compatible avec le lobby HOST / JOIN / READY existant.

Fonctions :
- Salons privés à 2, READY, START, reconnexion par jeton.
- Combat 2D synchronisé : deux tours automatiques, noyau partagé.
- Chaque joueur améliore uniquement sa tour.
- Tous les gains de cash et récompenses fin de run sont accordés à 100 % aux deux.
- Statistiques initiales : moyenne des stats envoyées par les deux clients.
- Vitesse commune limitée à la plus faible vitesse débloquée.
- Tours continuent de tirer si un joueur se déconnecte.
- Si les deux se déconnectent, fin de partie après 60 secondes (sauf défaite plus tôt).
- Le serveur est autoritaire pour les vagues, ennemis, achats et récompenses.

Limites de ce prototype pour jeu entre amis :
- Données de salon uniquement en mémoire. Un redémarrage de Render efface les runs en cours.
- Le serveur n'est pas un système anti-triche ni une économie sécurisée.
- Récompenses non stockées en ligne ; l'intégration à l'APK devra gérer leur remise unique.
- Aucun matchmaking public ni invitation d'amis dans cette étape.

Test : ouvrir InfiniteTower_COOP_Combat_Test.html dans deux fenêtres après le déploiement.
