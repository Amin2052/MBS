# Cloudflare deployment — MBS central server

The current Cloudflare Worker already has the D1 binding `DB -> mooral-db`.

## 1. Apply the cloud sync table
In the D1 Console for `mooral-db`, run the contents of:

`cloudflare/worker/schema.sql`

## 2. Worker variables
Set these Worker variables:

- `MBS_WORKSPACE_ID` = `mooral-main`
- `MBS_CORS_ORIGIN` = the exact deployed Worker URL, for example `https://mooral-mbs-api.<account>.workers.dev`

## 3. Worker secret
Create a strong random secret named:

`MBS_API_KEY`

This key is only for the Owner MBS desktop synchronization path. Never put it in the employee portal.

## 4. Deploy
From the `Test mode` project folder:

`npx wrangler deploy --config cloudflare/wrangler.toml`

## 5. Verify
Open the deployed Worker URL plus:

`/health`

Expected JSON includes:

`"ok":true`

`"database":"D1"`

## 6. MBS desktop
In MBS Settings → Integrations → Online Database & Internal Messaging:

- Enable MBS Cloud
- Cloud API URL = deployed Worker URL
- Workspace ID = `mooral-main`
- Cloud API Key = the same `MBS_API_KEY`
- Test Connection
- Sync Now

The desktop will then synchronize users, permission profiles and shared business records to D1 automatically every 15 seconds while Cloud sync is enabled.
