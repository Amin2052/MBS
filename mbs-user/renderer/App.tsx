import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  AlertTriangle, Building2, CheckCircle2, FileText, LayoutDashboard, Loader2, LogOut,
  Package, RefreshCw, Search, ShieldCheck, ShoppingCart, UserRound, Users, Wifi, WifiOff
} from "lucide-react";

import { hasPermission, type EmployeeSession } from "../shared/api-client";

// ===================================================================
// MBS-user renderer
//
// Modules are shown only when the owner has granted the matching permission,
// but every read and write is re-checked by the Worker and by the main
// process -- hiding a button is a usability decision here, never the
// security boundary.
// ===================================================================

type ViewKey = "dashboard" | "orders" | "customers" | "products" | "invoices" | "profile";
type Row = Record<string, unknown>;
type SessionView = Omit<EmployeeSession, "token">;

const NAV: Array<{ key: ViewKey; label: string; icon: typeof LayoutDashboard; permission?: string }> = [
  { key: "dashboard", label: "Overview", icon: LayoutDashboard, permission: "dashboard.view" },
  { key: "orders", label: "Orders", icon: ShoppingCart, permission: "orders.view" },
  { key: "customers", label: "Customers", icon: Users, permission: "customers.view" },
  { key: "products", label: "Products", icon: Package, permission: "products.view" },
  { key: "invoices", label: "Invoices", icon: FileText, permission: "invoices.view" },
  { key: "profile", label: "My profile", icon: UserRound }
];

function cellText(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function money(value: unknown): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  return amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function StatusPill({ value }: { value: unknown }): JSX.Element {
  const label = cellText(value);
  const tone = label.toLowerCase();
  const kind = tone.includes("complet") ? "ok" : tone.includes("cancel") ? "danger" : tone.includes("approval") ? "warn" : "neutral";
  return <span className={`pill pill-${kind}`}>{label}</span>;
}

function useCollection(collection: string, enabled: boolean) {

  const [state, setState] = useState<{ rows: Row[]; loading: boolean; error: string | null }>({
    rows: [], loading: false, error: null
  });

  const reload = useCallback(async () => {
    if (!enabled) {
      setState({ rows: [], loading: false, error: null });
      return;
    }
    setState(current => ({ ...current, loading: true, error: null }));
    const result = await window.mbsUser.data.list(collection);
    if (!result.success) setState({ rows: [], loading: false, error: result.error ?? "Could not load this list." });
    else setState({ rows: result.rows ?? [], loading: false, error: null });
  }, [collection, enabled]);

  useEffect(() => { void reload(); }, [reload]);

  return { ...state, reload };

}

interface Column {
  key: string;
  label: string;
  render?: (row: Row) => ReactNode;
}

function DataTable({ columns, rows, loading, error, empty }: {
  columns: Column[];
  rows: Row[];
  loading: boolean;
  error: string | null;
  empty: string;
}): JSX.Element {

  if (loading) return <div className="state"><Loader2 size={18} className="spin" /> Loading…</div>;
  if (error) return <div className="state state-error" role="alert"><AlertTriangle size={16} /> {error}</div>;
  if (!rows.length) return <div className="state">{empty}</div>;

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>{columns.map(column => <th key={column.key}>{column.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={String(row.local_id ?? index)}>
              {columns.map(column => (
                <td key={column.key}>{column.render ? column.render(row) : cellText(row[column.key])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

}

export default function App(): JSX.Element {

  const [session, setSession] = useState<SessionView | null>(null);
  const [config, setConfig] = useState({ apiUrl: "", workspaceId: "" });
  const [connection, setConnection] = useState<{ online: boolean; detail: string }>({ online: true, detail: "Checking connection…" });
  const [view, setView] = useState<ViewKey>("dashboard");
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const [pendingOrder, setPendingOrder] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [employeeId, setEmployeeId] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const [showServer, setShowServer] = useState(false);

  const orders = useCollection("orders", Boolean(session) && hasPermission(session, "orders.view"));
  const customers = useCollection("customers", Boolean(session) && hasPermission(session, "customers.view"));
  const products = useCollection("products", Boolean(session) && hasPermission(session, "products.view"));
  const invoices = useCollection("invoices", Boolean(session) && hasPermission(session, "invoices.view"));

  useEffect(() => {
    void (async () => {
      const stored = await window.mbsUser.config.get();
      setConfig({ apiUrl: stored.apiUrl, workspaceId: stored.workspaceId });
      setShowServer(!stored.apiUrl || !stored.workspaceId);
      const state = await window.mbsUser.connection.check();
      setConnection({ online: state.online, detail: state.detail });
    })();
  }, []);

  useEffect(() => {
    const offSession = window.mbsUser.onSessionChanged(payload => {
      setSession(payload.session);
      if (!payload.session) {
        setPendingOrder(null);
        setRowError(null);
        if (payload.reason) setLoginError(payload.reason);
      }
    });
    const offConnection = window.mbsUser.onConnectionChanged(payload => {
      setConnection({ online: payload.online, detail: payload.detail });
    });
    return () => { offSession(); offConnection(); };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => { setQuery(""); setRowError(null); }, [view]);

  const nav = useMemo(
    () => NAV.filter(item => !item.permission || hasPermission(session, item.permission)),
    [session]
  );

  useEffect(() => {
    if (session && !nav.some(item => item.key === view)) {
      setView(nav[0]?.key ?? "profile");
    }
  }, [nav, session, view]);

  async function handleLogin(event: FormEvent): Promise<void> {
    event.preventDefault();
    setLoginError(null);
    if (!config.apiUrl || !config.workspaceId) {
      setShowServer(true);
      setLoginError("Enter the server address and workspace id provided by your administrator.");
      return;
    }
    if (!employeeId.trim() || !password) {
      setLoginError("Employee ID and password are required.");
      return;
    }
    setLoggingIn(true);
    try {
      const saved = await window.mbsUser.config.set(config);
      if (!saved.success) {
        setShowServer(true);
        setLoginError(saved.error ?? "Could not save the connection settings.");
        return;
      }
      const result = await window.mbsUser.auth.login({ username: employeeId.trim(), password });
      if (!result.success || !result.session) {
        setLoginError(result.error ?? "Sign-in failed.");
        return;
      }
      setSession(result.session);
      setPassword("");
      setConnection({ online: true, detail: "Connected to the central server." });
      setView(nav[0]?.key ?? "dashboard");
      await window.mbsUser.connection.check();
    } finally {
      setLoggingIn(false);
    }
  }

  async function handleLogout(): Promise<void> {
    await window.mbsUser.auth.logout();
    setSession(null);
    setPassword("");
    setView("dashboard");
    setQuery("");
  }

  async function handleRefresh(): Promise<void> {
    setRefreshing(true);
    try {
      const refreshed = await window.mbsUser.auth.refresh();
      if (refreshed.session) setSession(refreshed.session);
      await Promise.all([orders.reload(), customers.reload(), products.reload(), invoices.reload()]);
      const state = await window.mbsUser.connection.check();
      setConnection({ online: state.online, detail: state.detail });
    } finally {
      setRefreshing(false);
    }
  }

  async function changeOrderStatus(row: Row, status: string): Promise<void> {
    const id = String(row.local_id ?? "");
    if (!id || !status) return;
    setPendingOrder(id);
    setRowError(null);
    try {
      const result = await window.mbsUser.orders.updateStatus({
        localId: id,
        status,
        expectedRevision: Number(row.sync_revision) || 0
      });
      if (result.success) {
        setNotice(`Order ${cellText(row.order_id) || id} updated to ${status}.`);
        await orders.reload();
        return;
      }
      setRowError({ id, message: result.error ?? "The update failed." });
      // A revision conflict means someone else changed this order: reload so
      // the employee is looking at the current version rather than a stale row.
      if (result.conflict) await orders.reload();
    } finally {
      setPendingOrder(null);
    }
  }

  function filterRows(rows: Row[]): Row[] {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(row => JSON.stringify(row).toLowerCase().includes(needle));
  }

  if (!session) {
    return (
      <div className="login-shell">

        <section className="login-brand">
          <div className="brand-mark"><Building2 size={22} /></div>
          <h1>MBS<span>user</span></h1>
          <p className="login-tagline">
            The employee workspace for Mooral Business Suite. Sign in with the employee ID your
            administrator created in the main application.
          </p>
          <ul className="login-points">
            <li><ShieldCheck size={15} /> Your access follows the permissions set in MBS.</li>
            <li><Wifi size={15} /> Works against the same central records as the owner.</li>
            <li><Building2 size={15} /> No company database or licence is stored on this computer.</li>
          </ul>
        </section>

        <section className="login-card">
          <h2>Sign in</h2>
          <p className="login-sub">Employee access</p>

          <form onSubmit={event => void handleLogin(event)}>
            <label className="field">
              <span>Employee ID</span>
              <input
                value={employeeId}
                onChange={event => setEmployeeId(event.target.value)}
                autoComplete="username"
                autoFocus
              />
            </label>

            <label className="field">
              <span>Password</span>
              <input
                type="password"
                value={password}
                onChange={event => setPassword(event.target.value)}
                autoComplete="current-password"
              />
            </label>

            <button type="button" className="link-button" onClick={() => setShowServer(value => !value)}>
              {showServer ? "Hide server settings" : "Server settings"}
            </button>

            {showServer && (
              <div className="server-panel">
                <label className="field">
                  <span>Server address</span>
                  <input
                    value={config.apiUrl}
                    onChange={event => setConfig(current => ({ ...current, apiUrl: event.target.value }))}
                    placeholder="https://mbs-cloud.example.workers.dev"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>
                <label className="field">
                  <span>Workspace ID</span>
                  <input
                    value={config.workspaceId}
                    onChange={event => setConfig(current => ({ ...current, workspaceId: event.target.value }))}
                    placeholder="acme-trading"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>
              </div>
            )}

            {loginError && (
              <div className="banner banner-error" role="alert"><AlertTriangle size={15} /> {loginError}</div>
            )}

            <button className="btn btn-primary btn-block" type="submit" disabled={loggingIn}>
              {loggingIn ? <><Loader2 size={16} className="spin" /> Signing in…</> : "Sign in"}
            </button>
          </form>

          <p className="login-hint">
            Ask your administrator for the employee ID, password, server address and workspace ID.
            Access can be revoked at any time from the main MBS application.
          </p>
        </section>

      </div>
    );
  }

  const canEditOrders = hasPermission(session, "orders.edit");
  const pendingOrders = orders.rows.filter(row => String(row.status || "").toLowerCase().startsWith("pending")).length;
  const orderValue = orders.rows.reduce((sum, row) => sum + (Number(row.total) || 0), 0);
  const expires = new Date(session.expiresAt * 1000);

  return (
    <div className="app-shell">

      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark small"><Building2 size={16} /></div>
          <div>
            <div className="brand-name">MBS<span>user</span></div>
            <div className="brand-sub">Employee workspace</div>
          </div>
        </div>

        <nav className="nav">
          {nav.map(item => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                className={`nav-item ${view === item.key ? "active" : ""}`}
                onClick={() => setView(item.key)}
              >
                <Icon size={16} />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-foot">
          <div className="user-chip">
            <div className="avatar">{session.user.fullName.slice(0, 1).toUpperCase()}</div>
            <div>
              <div className="user-name">{session.user.fullName}</div>
              <div className="user-role">{session.user.designation || session.user.userType}</div>
            </div>
          </div>
          <button className="nav-item" onClick={() => void handleLogout()}>
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </aside>

      <main className="main">

        <header className="topbar">
          <div className="topbar-title">
            {NAV.find(item => item.key === view)?.label}
          </div>
          <div className="topbar-actions">
            <span className={`connection ${connection.online ? "online" : "offline"}`} title={connection.detail}>
              {connection.online ? <Wifi size={14} /> : <WifiOff size={14} />}
              {connection.online ? "Connected" : "Offline"}
            </span>
            <button className="icon-button" onClick={() => void handleRefresh()} disabled={refreshing} title="Refresh">
              <RefreshCw size={15} className={refreshing ? "spin" : ""} />
            </button>
          </div>
        </header>

        <div className="content">

          {!connection.online && (
            <div className="banner banner-warn" role="status">
              <WifiOff size={15} />
              <div>
                <strong>The central server is unreachable.</strong> You can read what is already on screen,
                but changes are disabled and nothing will be reported as saved.
              </div>
            </div>
          )}

          {session.user.mustChangePassword && (
            <div className="banner banner-warn" role="status">
              <AlertTriangle size={15} />
              Your password was set by an administrator. Ask them to reset it in MBS.
            </div>
          )}

          {notice && (
            <div className="banner banner-ok" role="status"><CheckCircle2 size={15} /> {notice}</div>
          )}

          {view === "dashboard" && (
            <>
              <div className="card-grid">
                <div className="stat-card">
                  <div className="stat-label"><ShoppingCart size={14} /> Orders visible</div>
                  <div className="stat-value">{orders.loading ? "…" : orders.rows.length}</div>
                  <div className="stat-meta">{pendingOrders} still pending</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label"><Users size={14} /> Customers</div>
                  <div className="stat-value">{customers.loading ? "…" : customers.rows.length}</div>
                  <div className="stat-meta">Shared with the owner's MBS</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label"><Package size={14} /> Products</div>
                  <div className="stat-value">{products.loading ? "…" : products.rows.length}</div>
                  <div className="stat-meta">Live central catalogue</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label"><FileText size={14} /> Order value</div>
                  <div className="stat-value">{money(orderValue)}</div>
                  <div className="stat-meta">{invoices.rows.length} invoices on file</div>
                </div>
              </div>

              <div className="split">
                <section className="section">
                  <div className="section-head">
                    <h3>Recent orders</h3>
                    {hasPermission(session, "orders.view") && (
                      <button className="btn btn-ghost" onClick={() => setView("orders")}>Open orders</button>
                    )}
                  </div>
                  <DataTable
                    columns={[
                      { key: "order_id", label: "Order" },
                      { key: "customer_name", label: "Customer" },
                      { key: "total", label: "Total", render: row => money(row.total) },
                      { key: "status", label: "Status", render: row => <StatusPill value={row.status} /> }
                    ]}
                    rows={orders.rows.slice(0, 6)}
                    loading={orders.loading}
                    error={orders.error}
                    empty="No orders are visible to your account."
                  />
                </section>

                <section className="section profile-mini">
                  <div className="section-head"><h3>Your access</h3></div>
                  <p className="profile-line"><strong>{session.user.fullName}</strong></p>
                  <p className="profile-line">{session.user.designation || "Employee"} · {session.user.username}</p>
                  <div className="perm-chips">
                    {session.unrestricted
                      ? <span className="pill pill-ok">Full access</span>
                      : session.permissions.length
                        ? session.permissions.map(key => <span className="pill pill-neutral" key={key}>{key}</span>)
                        : <span className="pill pill-warn">No modules granted</span>}
                  </div>
                  <p className="profile-line muted">Session ends {expires.toLocaleString()}</p>
                </section>
              </div>
            </>
          )}

          {view === "orders" && (
            <section className="section">
              <div className="section-head">
                <h3>Orders</h3>
                <div className="search">
                  <Search size={14} />
                  <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search orders" />
                </div>
              </div>

              {!canEditOrders && <p className="muted small">You have read-only access to orders.</p>}

              {orders.loading && <div className="state"><Loader2 size={18} className="spin" /> Loading orders…</div>}
              {!orders.loading && orders.error && <div className="state state-error" role="alert"><AlertTriangle size={16} /> {orders.error}</div>}
              {!orders.loading && !orders.error && !filterRows(orders.rows).length && (
                <div className="state">No orders match your access or search.</div>
              )}

              {!orders.loading && !orders.error && filterRows(orders.rows).length > 0 && (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Order</th><th>Customer</th><th>Product</th><th>Qty</th>
                        <th>Total</th><th>Status</th><th>Updated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filterRows(orders.rows).map(row => {
                        const id = String(row.local_id ?? "");
                        const busy = pendingOrder === id;
                        const error = rowError?.id === id ? rowError.message : null;
                        return (
                          <tr key={id || String(row.order_id)} className={error ? "has-error" : ""}>
                            <td>{cellText(row.order_id)}</td>
                            <td>{cellText(row.customer_name)}</td>
                            <td>{cellText(row.product_name)}</td>
                            <td>{cellText(row.quantity)}</td>
                            <td>{money(row.total)}</td>
                            <td>
                              {canEditOrders ? (
                                <>
                                  <select
                                    className="select"
                                    value={String(row.status || "Pending")}
                                    disabled={busy || !connection.online}
                                    onChange={event => void changeOrderStatus(row, event.target.value)}
                                  >
                                    {window.mbsUser.orders.statuses.map(status => (
                                      <option key={status} value={status}>{status}</option>
                                    ))}
                                  </select>
                                  {busy && <Loader2 size={13} className="spin" />}
                                  {error && <div className="row-error" role="alert">{error}</div>}
                                </>
                              ) : <StatusPill value={row.status} />}
                            </td>
                            <td className="muted small">{cellText(row.updated_at)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {view === "customers" && (
            <section className="section">
              <div className="section-head">
                <h3>Customers</h3>
                <div className="search">
                  <Search size={14} />
                  <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search customers" />
                </div>
              </div>
              <DataTable
                columns={[
                  { key: "name", label: "Name" },
                  { key: "phone", label: "Phone" },
                  { key: "email", label: "Email" },
                  { key: "address", label: "Address" }
                ]}
                rows={filterRows(customers.rows)}
                loading={customers.loading}
                error={customers.error}
                empty="No customers are visible to your account."
              />
            </section>
          )}

          {view === "products" && (
            <section className="section">
              <div className="section-head">
                <h3>Products</h3>
                <div className="search">
                  <Search size={14} />
                  <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search products" />
                </div>
              </div>
              <DataTable
                columns={[
                  { key: "name", label: "Product" },
                  { key: "sku", label: "SKU" },
                  { key: "category", label: "Category" },
                  { key: "price", label: "Price", render: row => money(row.price) },
                  { key: "stock", label: "Stock" }
                ]}
                rows={filterRows(products.rows)}
                loading={products.loading}
                error={products.error}
                empty="No products are visible to your account."
              />
            </section>
          )}

          {view === "invoices" && (
            <section className="section">
              <div className="section-head"><h3>Invoices</h3></div>
              <p className="muted small">Invoices are generated by the owner from completed orders. This view is read-only.</p>
              <DataTable
                columns={[
                  { key: "invoice_id", label: "Invoice" },
                  { key: "customer_name", label: "Customer" },
                  { key: "total", label: "Total", render: row => money(row.total) },
                  { key: "due", label: "Due", render: row => money(row.due) },
                  { key: "status", label: "Status", render: row => <StatusPill value={row.status} /> },
                  { key: "invoice_date", label: "Date" }
                ]}
                rows={invoices.rows}
                loading={invoices.loading}
                error={invoices.error}
                empty="No invoices are visible to your account."
              />
            </section>
          )}

          {view === "profile" && (
            <section className="section profile-card">
              <div className="profile-head">
                <div className="avatar large">{session.user.fullName.slice(0, 1).toUpperCase()}</div>
                <div>
                  <h3>{session.user.fullName}</h3>
                  <p className="muted">{session.user.designation || "Employee"} · {session.user.username}</p>
                </div>
              </div>

              <dl className="profile-grid">
                <div><dt>Employee ID</dt><dd>{cellText(session.user.username)}</dd></div>
                <div><dt>Role</dt><dd>{session.user.userType}</dd></div>
                <div><dt>Email</dt><dd>{cellText(session.user.email)}</dd></div>
                <div><dt>Phone</dt><dd>{cellText(session.user.phone)}</dd></div>
                <div><dt>Session ends</dt><dd>{expires.toLocaleString()}</dd></div>
                <div><dt>Central reset generation</dt><dd>{session.resetEpoch}</dd></div>
              </dl>

              <h4>Permissions granted by the owner</h4>
              <div className="perm-chips">
                {session.unrestricted
                  ? <span className="pill pill-ok">Full access (administrator)</span>
                  : session.permissions.length
                    ? session.permissions.map(key => <span className="pill pill-neutral" key={key}>{key}</span>)
                    : <span className="pill pill-warn">No modules granted</span>}
              </div>

              <div className="settings-actions">
                <button className="btn btn-primary" onClick={() => void handleRefresh()} disabled={refreshing}>
                  <RefreshCw size={15} className={refreshing ? "spin" : ""} /> Refresh access
                </button>
                <button className="btn btn-ghost" onClick={() => void handleLogout()}>
                  <LogOut size={15} /> Sign out
                </button>
              </div>
            </section>
          )}

        </div>
      </main>
    </div>
  );

}
