# MBS Cloud Gateway

Self-hosted online gateway for Mooral Business Suite.

## Run

```powershell
$env:MBS_CLOUD_API_KEY="replace-with-a-long-random-key"
$env:MBS_CLOUD_PORT="8787"
npm run cloud-server
```

Open `http://SERVER:8787/health` to verify the service.

The gateway provides:
- workspace-scoped online database upload/download
- online user directory
- internal online messaging API
- API-key authentication

The desktop app remains offline-first. Cloud sync is opt-in and requires the gateway URL, workspace ID, and API key.
