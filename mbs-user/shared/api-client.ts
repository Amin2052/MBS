// ===================================================================
// MBS-user employee client
//
// Deliberately framework-free and dependency-free: the Electron main process
// imports it, and tests/main/entry-mbs-user.ts imports the SAME file against
// the real Worker (cloudflare/worker/index.js) running in-process. That is
// what makes the test evidence evidence about the shipped client, not a
// hand-written mock of it.
//
// There is NO workspace API key here, by design. MBS-user authenticates as a
// person (employee username + password) and receives a short-lived session
// token; every call is authorised by the Worker against that user's real
// permission rows. The owner's installation key never ships to an employee
// PC, and this client has no code path that can use one.
// ===================================================================

export interface EmployeeUser {
  id: number;
  username: string;
  fullName: string;
  userType: "owner" | "administrator" | "employee";
  status: string;
  employeeId: number | null;
  permissionProfileId: number | null;
  mustChangePassword: boolean;
  email: string;
  phone: string;
  designation: string;
}

export interface EmployeeSession {
  token: string;
  /** Unix seconds, as issued by the Worker. */
  expiresAt: number;
  user: EmployeeUser;
  permissions: string[];
  /** true for owner/administrator, who are not scoped by the catalog. */
  unrestricted: boolean;
  resetEpoch: number;
}

export interface OrderStatusUpdate {
  localId: string;
  status: string;
}

/** The statuses the main MBS application itself writes (see
 *  src/pages/orders-page.tsx). The employee client refuses anything else
 *  locally so a typo cannot create an order state the owner's app will not
 *  understand -- the Worker stores what it is given. */
export const ORDER_STATUSES = ["Pending", "Pending Approval", "Completed", "Cancelled"] as const;
export type OrderStatus = typeof ORDER_STATUSES[number];

export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === "string" && (ORDER_STATUSES as readonly string[]).includes(value);
}

export function normalizeBaseUrl(value: string): string {
  return String(value || "").trim().replace(/\/+$/, "");
}

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export class SessionExpiredError extends ApiError {
  constructor() {
    super("Your session has ended. Sign in again.", 401, "session_expired");
    this.name = "SessionExpiredError";
  }
}

export class RevisionConflictError extends Error {
  currentRevision: number;
  currentRow: Record<string, unknown> | null;
  constructor(message: string, currentRevision: number, currentRow: Record<string, unknown> | null) {
    super(message);
    this.name = "RevisionConflictError";
    this.currentRevision = currentRevision;
    this.currentRow = currentRow;
  }
}

interface ClientConfig { baseUrl: string; workspaceId: string }

export class EmployeeClient {

  private baseUrl: string;
  private workspaceId: string;

  constructor(config: ClientConfig) {
    this.baseUrl = normalizeBaseUrl(config.baseUrl);
    this.workspaceId = String(config.workspaceId || "").trim();
  }

  private headers(token?: string, extra: Record<string, string> = {}): Record<string, string> {
    const headers: Record<string, string> = { "x-workspace-id": this.workspaceId, ...extra };
    if (token) headers.authorization = `Bearer ${token}`;
    return headers;
  }

  private async request(path: string, init: RequestInit, token?: string): Promise<Response> {
    if (!this.baseUrl) throw new ApiError("Server address is not configured.", 0, "not_configured");
    if (!this.workspaceId) throw new ApiError("Workspace id is not configured.", 0, "not_configured");

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, init);
    } catch (error) {
      // undici reports DNS/refused/timeout as a TypeError. Surfacing it as a
      // distinct code lets the UI show "can't reach the server" instead of a
      // generic failure, and lets callers decide not to retry a write.
      throw new ApiError(`Cannot reach ${this.baseUrl}. ${error instanceof Error ? error.message : ""}`.trim(), 0, "offline");
    }

    if (response.status === 401) throw new SessionExpiredError();
    return response;
  }

  private async json<T>(response: Response): Promise<T> {
    const bodyText = await response.text();
    if (!response.ok) throw new ApiError(bodyText || `Request failed (${response.status}).`, response.status);
    return (bodyText ? JSON.parse(bodyText) : {}) as T;
  }

  async health(): Promise<{ ok: boolean }> {
    const response = await this.request("/health", { method: "GET", headers: this.headers() });
    if (!response.ok) throw new ApiError(`Health check failed (${response.status}).`, response.status);
    return await response.json() as { ok: boolean };
  }

  /** Employee ID and password against the central Worker. No separate
   *  employee database exists: these are the accounts the owner created in
   *  MBS and that MBS syncs to D1. */
  async login(username: string, password: string): Promise<EmployeeSession> {
    const response = await this.request("/v1/auth/login", {
      method: "POST",
      headers: this.headers(undefined, { "content-type": "application/json" }),
      body: JSON.stringify({ username, password, workspaceId: this.workspaceId })
    });

    const bodyText = await response.text();
    if (!response.ok) {
      if (response.status === 423) throw new ApiError("Account temporarily locked after repeated failed attempts.", 423, "locked");
      throw new ApiError(response.status === 401 ? "Incorrect employee ID or password." : bodyText || "Sign-in failed.", response.status);
    }

    const payload = JSON.parse(bodyText) as { token?: string; expiresAt?: number; user?: Record<string, unknown> };
    if (!payload.token || !payload.user) throw new ApiError("The server returned an incomplete session.", response.status);

    const token = payload.token;
    const granted = await this.permissions(token);
    return {
      token,
      expiresAt: Number(payload.expiresAt) || Math.floor(Date.now() / 1000),
      user: granted.user,
      permissions: granted.permissions,
      unrestricted: granted.unrestricted,
      resetEpoch: granted.resetEpoch
    };
  }

  /** Effective grants straight from the Worker. Also acts as the session
   *  liveness check: a disabled user or revoked token returns 401. */
  async permissions(token: string): Promise<{ user: EmployeeUser; permissions: string[]; unrestricted: boolean; resetEpoch: number }> {
    const response = await this.request("/v1/me/permissions", { method: "GET", headers: this.headers(token) }, token);
    const body = await this.json<{ user: Record<string, unknown>; permissions?: string[]; unrestricted?: boolean; resetEpoch?: number }>(response);
    return {
      user: toEmployeeUser(body.user),
      permissions: Array.isArray(body.permissions) ? body.permissions.map(String) : [],
      unrestricted: Boolean(body.unrestricted),
      resetEpoch: Number(body.resetEpoch) || 0
    };
  }

  async list(token: string, collection: string, limit = 200): Promise<Record<string, unknown>[]> {
    const capped = Math.min(Math.max(Number(limit) || 200, 1), 500);
    const response = await this.request(`/v1/data/${encodeURIComponent(collection)}?limit=${capped}`, {
      method: "GET", headers: this.headers(token)
    }, token);
    const body = await this.json<{ rows?: Record<string, unknown>[] }>(response);
    return Array.isArray(body.rows) ? body.rows : [];
  }

  /** The one write this app performs on business records. Optimistic
   *  concurrency is mandatory here: without expected_revision two employees
   *  editing the same order would silently overwrite each other, which the
   *  Worker's PATCH only prevents when the caller supplies the revision it
   *  last saw. */
  async updateOrderStatus(token: string, localId: string, status: string, expectedRevision: number): Promise<{ syncRevision: number }> {
    if (!isOrderStatus(status)) throw new ApiError(`Unknown order status '${status}'.`, 400, "invalid_status");
    const id = String(localId || "").trim();
    if (!id) throw new ApiError("Order id is required.", 400, "invalid_id");

    const response = await this.request(`/v1/data/orders/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: this.headers(token, { "content-type": "application/json" }),
      body: JSON.stringify({ status, expected_revision: Number(expectedRevision) })
    }, token);

    const bodyText = await response.text();
    if (response.status === 409) {
      let parsed: any = null;
      try { parsed = JSON.parse(bodyText); } catch { /* non-JSON 409 -> generic */ }
      if (parsed && parsed.error === "revision_conflict") {
        throw new RevisionConflictError(
          "This order was changed by someone else since you opened it. Refresh to see the current version.",
          Number(parsed.current_revision) || 0,
          parsed.current && typeof parsed.current === "object" ? parsed.current as Record<string, unknown> : null
        );
      }
      throw new ApiError(parsed?.message || "This order cannot be updated.", 409, parsed?.error);
    }
    if (!response.ok) throw new ApiError(bodyText || `Order update failed (${response.status}).`, response.status);

    const parsed = bodyText ? JSON.parse(bodyText) as { sync_revision?: number } : {};
    return { syncRevision: Number(parsed.sync_revision) || Number(expectedRevision) + 1 };
  }

  async logout(token: string): Promise<void> {
    // Best effort: a network failure must not keep the local session alive.
    try {
      await this.request("/v1/auth/logout", { method: "POST", headers: this.headers(token) }, token);
    } catch {
      // ignore
    }
  }

}

export function toEmployeeUser(raw: Record<string, unknown> | null | undefined): EmployeeUser {
  const row = raw || {};
  return {
    id: Number(row.id) || 0,
    username: String(row.username || ""),
    fullName: String(row.fullName || row.username || ""),
    userType: (row.userType === "owner" || row.userType === "administrator") ? row.userType : "employee",
    status: String(row.status || "active"),
    employeeId: row.employeeId == null ? null : Number(row.employeeId),
    permissionProfileId: row.permissionProfileId == null ? null : Number(row.permissionProfileId),
    mustChangePassword: Boolean(row.mustChangePassword),
    email: String(row.email || ""),
    phone: String(row.phone || ""),
    designation: String(row.designation || "")
  };
}

/** Single place that answers "may this session do X". The Worker enforces
 *  the same keys server-side (can() in cloudflare/worker/index.js); this is
 *  the UI's copy of that decision, never a substitute for it. */
export function hasPermission(session: Pick<EmployeeSession, "permissions" | "unrestricted"> | null, key: string): boolean {
  if (!session) return false;
  if (session.unrestricted) return true;
  return session.permissions.includes(key);
}
