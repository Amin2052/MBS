// ===================================================================
// Default connection for a fresh MBS-user installation.
//
// MBS-user stores no company data and has no workspace API key, so the only
// things it needs to reach the company's cloud are the Worker address and the
// workspace id -- neither is a secret (the Worker still requires a valid
// employee username + password before it returns anything).
//
// Without these, a new installation had an empty address/workspace, no field
// to type them into, and every sign-in failed before reaching the server.
//
// Values mirror cloudflare/wrangler.toml (worker "mooral-mbs-api") and the
// workspace the owner's MBS syncs to. A different company/deployment changes
// them here before building, or on a single PC via Server settings on the
// sign-in page (administrator password), or with
//   MBS-user.exe --api-url=https://... --workspace=<id>
// ===================================================================
export const DEFAULT_API_URL = "https://mooral-mbs-api.alamin2052.workers.dev";
export const DEFAULT_WORKSPACE_ID = "mooral-main";
