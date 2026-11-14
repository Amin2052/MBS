# MBS Online Deployment

## Architecture
- The central online API is the source of truth for shared workspace data.
- The Electron application can retain local SQLite as an offline cache.
- Users authenticate against the configured online service.
- CRUD permissions must be enforced server-side for Owner/Admin/Employee roles.
- Messages are stored and synchronized through the online messaging API.

## Before production
1. Configure the production API/database URL.
2. Configure authentication secrets.
3. Provision the central database.
4. Apply database migrations.
5. Enable HTTPS.
6. Run `npm install`, `npm run typecheck`, and `npm run build`.
7. Test two separate client sessions against the same workspace.
