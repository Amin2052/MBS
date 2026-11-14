# MBS Central Employee Portal — Cloudflare Free Setup

The MBS project now includes a deployment-ready Cloudflare Workers + D1 central platform under `cloudflare/`.

## What is included
- Central authenticated API using Cloudflare Workers
- Cloudflare D1 schema for workspaces, users, sessions, records and messages
- Bearer-session employee login
- Server-side role enforcement
- Existing MBS API-key/workspace compatibility path
- Lightweight employee web portal served by the same Worker
- Revisioned central records
- Message access/ownership checks

## First deployment
Run from the MBS project root:

```powershell
npx wrangler login
npx wrangler d1 create mooral-business-suite
```

Put the returned D1 `database_id` into `cloudflare/wrangler.toml`.

Then:

```powershell
npx wrangler d1 execute mooral-business-suite --remote --file=cloudflare/worker/schema.sql
npx wrangler secret put MBS_API_KEY --config cloudflare/wrangler.toml
npx wrangler deploy --config cloudflare/wrangler.toml
```

The Worker will serve both the API and employee portal.

## Owner bootstrap
After deployment, initialize the first owner once with the API:

`POST /v1/auth/bootstrap`

JSON:

```json
{
  "workspaceId": "YOUR_COMPANY_ID",
  "username": "owner",
  "password": "USE-A-STRONG-PASSWORD",
  "fullName": "Company Owner"
}
```

Do not expose the bootstrap endpoint publicly after the first owner is created; remove/disable it before production use or protect it with an administrative setup secret.

## Important
Cloudflare deployment cannot be completed from this project package alone because it requires the owner's Cloudflare account, D1 database ID, and secret. The source is prepared for deployment; credentials are intentionally not embedded.
