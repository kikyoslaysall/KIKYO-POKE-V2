# KIKYO MD API backend (Node.js / Pterodactyl)

This is the updated API service for the KIKYO Android app. It is a separate Node.js service; it is **not** the Pterodactyl panel API and must not be given a Pterodactyl Application/Client API key.

## Deploy on Pterodactyl

1. Create a Node.js server using Node 20 or newer.
2. Upload the contents of this folder (not the enclosing folder) to the server.
3. Set the startup command to `npm start` (or `node src/server.js`).
4. Install dependencies: `npm install` (there are no third-party runtime dependencies).
5. Ensure the server's data directory is on persistent storage. By default it is `backend/data` relative to `src/server.js`; set `KIKYO_DATA_DIR` to a persistent mounted path if your host provides one.
6. Start the server. Pterodactyl should provide `PORT`; the process listens on `0.0.0.0`.
7. Configure a public HTTPS reverse proxy/domain to forward to this service's port. The API base URL is the public origin, e.g. `https://api.your-domain.example` (example only). Do not use the Pterodactyl panel URL unless it is deliberately configured as the reverse proxy.

## Health checks

- `GET /health`
- `GET /api/v1/health`
- `GET /api/v1/status`

## Create a one-time sign-in invite

After starting the API once, use the Pterodactyl console (or server shell) to run:

```bash
node scripts/create-invite.js "Trainer display name"
```

It creates a blank trainer and prints a random, single-use invite code valid for 24 hours. In the Android app/backend integration, send it to `POST /api/v1/auth/redeem-invite` as JSON `{ "code": "..." }`. The response contains a bearer access token. Keep the invite private and do not commit it to GitHub. Sessions expire after `SESSION_DAYS` (default 14).

## Available API routes

Public: `GET /health`, `GET /api/v1/health`, `GET /api/v1/status`, `POST /api/v1/auth/redeem-invite`.

Bearer-authenticated: `POST /api/v1/auth/logout`, `GET /api/v1/me`, `GET /api/v1/pokemon/collection`, `POST /api/v1/pokemon/party`, `GET /api/v1/inventory`, `GET /api/v1/world`, `GET /api/v1/regions`, `GET /api/v1/battles`, `GET /api/v1/pve/progress`, `GET /api/v1/raids`, `GET /api/v1/league`, `GET /api/v1/guild`.

## Important integration status

This backend currently stores its own trainer records. It does **not** yet read/write the live WhatsApp bot's player database, does not implement OTP delivery, and does not run the actual Pokémon battle/PvE/raid/league engine. Battle action endpoints deliberately return `501 GAME_ENGINE_NOT_CONNECTED` rather than inventing battles or rewards. To share player progress, a proper adapter must be written against the exact WhatsApp bot database schema and safely deployed with backups. Do not point this service at the live bot database until that adapter has been implemented and tested.

## Security and operations

- Put this API behind HTTPS before real use.
- Never place Pterodactyl credentials, WhatsApp session files, or private admin keys in the APK or GitHub repository.
- Back up `data/store.json` and the persistent volume before updates.
- Do not delete or replace the live WhatsApp bot database when deploying this separate API.
- The API includes basic per-IP rate limiting and a request body size limit; production deployment should additionally use a reverse proxy/WAF and proper monitoring.
