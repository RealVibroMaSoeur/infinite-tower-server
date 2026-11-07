# Infinite Tower — CO-OP Server (2 à 4 Joueurs) 2.1.4

Serveur multijoueur autoritaire et temps réel pour **Infinite Tower 2.1.4**, basé sur le moteur partagé unique `combat-core.js`.

---

## Architecture & Principes

1. **Un seul moteur commun (`combat-core.js`)** :
   Le serveur exécute exactement les mêmes calculs de combat, de stats, de ciblage et de vagues que le client Android SOLO. Aucune divergence de règles ni de formules.
2. **Multi-joueurs (2 à 4 joueurs simultanés)** :
   Positions cardinales fixes :
   - Slot 0 : Nord
   - Slot 1 : Sud
   - Slot 2 : Est
   - Slot 3 : Ouest
3. **Vagues de 10 secondes synchronisées** :
   Chaque vague dure exactement 10s à vitesse ×1. Les ennemis survivants continuent le combat lors de la vague suivante.
4. **Ressources individuelles & PV d'équipe partagés** :
   Le cash gagné et les améliorations achetées en combat sont propres à chaque joueur. Les PV de l'équipe correspondent à la somme des PV des tours actives.
5. **Résilience et Persistance Render** :
   - Support natif du disque persistant Render (`/var/data`) ou stockage local configuré via `DATA_DIR`.
   - Délai de grâce de déconnexion : 45 secondes (`RECONNECT_GRACE_MS`).
   - Reconnexion sans perte d'état via jeton sécurisé (`reconnectToken`).
   - Persistance automatique des salons actifs (`active_rooms.json`), des comptes (`social.json`) et du registre des récompenses (`rewards.json`), permettant la reprise de partie même après un redémarrage ou redéploiement complet du conteneur Render.
   - Protection anti-duplication et idempotence stricte des récompenses (`resultId` cryptographique unique par joueur et par salon) validée atomiquement par le serveur.

---

## Déploiement sur Render

### Option A : Déploiement automatique via Blueprint (`render.yaml`)
1. Connecter le dépôt GitHub à Render.
2. Render détectera automatiquement `render.yaml` avec disque persistant (`infinite-tower-data`, mount `/var/data`).
3. Le service Web Node.js sera provisionné et démarré automatiquement.

### Option B : Déploiement manuel sur Render
- **Environment** : `Node` (Node.js 20.18.1)
- **Build Command** : `npm install`
- **Start Command** : `node server.js`
- **Port** : `8080` (géré par `$PORT`)
- **Disk Mount** : `/var/data` (1 Go)
- **Variable d'environnement** : `DATA_DIR=/var/data`

---

## API REST & WebSocket

- `GET /health` : État de santé, uptime, nombre de salons et récompenses enregistrées.
- `POST /claim_reward` : Réclamation atomique d'une récompense (`{ resultId, playerId }`). Idempotent (409 Conflict si déjà réclamé).
- `GET /reward/:resultId` : Consultation de l'état d'une récompense.
- `GET /unclaimed_rewards?playerId=...` : Récupération des récompenses en attente.
- `WebSocket` (`ws://` ou `wss://`) :
  - `register`, `login`, `friends`, `friend_request`, `friend_accept`, `invite`
  - `host` / `create_room`, `join` / `join_room`, `ready`, `start`
  - `reconnect_room` (avec `reconnectToken`)
  - `upgrade`, `set_speed`, `set_target_priority`, `leave_room`, `claim_reward`

---

## Démarrage Local

```bash
# Installation des dépendances
npm install

# Démarrage du serveur
node server.js

# Exécution des tests de régression
npm test
```
