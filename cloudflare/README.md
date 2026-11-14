# Mooral Business Suite — Cloudflare Central Platform

## Architecture
- Cloudflare Worker = central HTTPS API
- Cloudflare D1 `mooral-db` = central relational database
- Existing MBS `users`, `sessions`, permissions and business tables remain the source schema.
- `cloud_records` is the offline/online synchronization layer used by the desktop client and employee portal.
- Employee portal is served by the same Worker, so it does not need a second host.

## Required Cloudflare configuration
Create these Worker settings/secrets:

- D1 binding: `DB` -> `mooral-db`
- Variable: `MBS_WORKSPACE_ID` -> a stable value such as `mooral-main`
- Variable: `MBS_CORS_ORIGIN` -> the exact Worker/portal origin (for example `https://mooral-mbs-api.<account>.workers.dev`)
- Secret: `MBS_API_KEY` -> a long random value used only by the Owner MBS desktop for administrative synchronization.

Never put `MBS_API_KEY` in the employee portal.

## Deploy
1. Apply `worker/schema.sql` to the existing D1 database.
2. Deploy this Worker.
3. Open `/health` and confirm `database: D1`.
4. Configure the MBS desktop Cloud API URL to the deployed Worker URL and Workspace ID to `MBS_WORKSPACE_ID`.
5. Enter the same `MBS_API_KEY` in the Owner MBS Cloud settings. The desktop stores it with Electron `safeStorage`.

## Authentication
Employee/Administrator/Owner portal login uses the existing MBS `users.password_hash` scrypt format. The Worker verifies the same scrypt format and creates a server-side session in the existing `sessions` table. Password hashes are never returned to clients.

## Security
- Parameterized D1 statements
- Server-side RBAC using `profile_permissions` + `user_permissions`
- Session token hashes only
- Brute-force lockout using the existing `failed_login_attempts` / `locked_until` fields
- Request body limits
- Strict collection allow-list
- Origin-restricted CORS
- API key reserved for desktop/admin synchronization
- Message sender/recipient authorization enforced server-side
