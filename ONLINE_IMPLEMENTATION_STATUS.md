# MBS Online Implementation Status

- Central online status endpoint: `/v1/online/status`
- Shared-record read/write API: `/v1/online/records/:collection`
- Existing cloud database upload/download APIs preserved.
- Existing messaging modules preserved.
- Renderer helper: `src/services/online-shared-data-service.ts`

Runtime deployment still requires the configured server database/auth provider and environment variables.
