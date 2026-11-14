import {
  DollarSign,
  ShoppingCart,
  Users,
  Package,
  AlertTriangle,
  Plus,
  UserPlus,
  FileText,
  Bell,
  Search,
  X,
  Trash2
} from "lucide-react";

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer
} from "recharts";

import "./dashboard.css";

import MessagesCard from "@/components/dashboard/messages-card";

import { formatNumber } from "../utils/format-number";

import { formatDateTime } from "../utils/date-format";

import { useAuth } from "@/hooks/use-auth";
import { useCurrency } from "@/hooks/use-currency";
import { useLanguage } from "@/hooks/use-language";

// Customer, Product and Order are declared globally in src/types/electron.d.ts
// (previously this file redeclared narrower local copies of these types,
// which had drifted out of sync with the real IPC/database shape).

type TopProduct = {
  name: string;
  quantity: number;
};

type MonthlySales = {
  month: string;
  sales: number;
};

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];

/**
 * Builds the last 6 months of real sales totals from order data.
 * Falls back gracefully if an order is missing created_at (older rows).
 */
function buildMonthlySales(orders: Order[]): MonthlySales[] {
  const now = new Date();

  const buckets: MonthlySales[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push({ month: MONTH_LABELS[d.getMonth()], sales: 0 });
  }

  orders.forEach(order => {
    if (!order.created_at) return;

    const orderDate = new Date(order.created_at);
    if (Number.isNaN(orderDate.getTime())) return;

    const monthsAgo =
      (now.getFullYear() - orderDate.getFullYear()) * 12 +
      (now.getMonth() - orderDate.getMonth());

    if (monthsAgo < 0 || monthsAgo > 5) return;

    const bucketIndex = 5 - monthsAgo;
    buckets[bucketIndex].sales += Number(order.total || 0);
  });

  return buckets;
}

/**
 * Maps an order status to the same badge modifier classes used on the
 * Orders page, so "Recent Orders" reads consistently with the rest of
 * the app instead of introducing a new visual style.
 */
function statusClass(status: string): string {
  switch ((status || "").toLowerCase()) {
    case "completed":
      return "status-badge status-completed";
    case "cancelled":
      return "status-badge status-cancelled";
    default:
      return "status-badge status-pending";
  }
}

export default function DashboardPage(): JSX.Element {
  const navigate = useNavigate();
  const { format: formatCurrency } = useCurrency();
  const { t } = useLanguage();

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Notifications widget: real permission-based access (Owner/
  // Administrator can delete/reset; Employees are view-only) instead
  // of the removed client-side app-role.ts. Server-side enforcement
  // lives in main.ts's notifications:delete / notifications:reset
  // handlers (requireUserType("owner", "administrator")) -- this is
  // only the UI-visibility mirror of that same rule.
  const { user } = useAuth();
  const canManageNotifications = user?.user_type === "owner" || user?.user_type === "administrator";
  const isOwner = user?.user_type === "owner";
  const isAdministrator = user?.user_type === "administrator";

  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [notificationSearch, setNotificationSearch] = useState("");
  const [selectedNotification, setSelectedNotification] =
    useState<AppNotification | null>(null);

  async function loadNotifications() {
    try {
      const data = await window.mooral.notifications.get();
      setNotifications(data);
    } catch (error) {
      console.error("Failed to load notifications", error);
    }
  }

  useEffect(() => {
    loadNotifications();
  }, []);

  const filteredNotifications = useMemo(() => {
    const normalized = notificationSearch.trim().toLowerCase();
    if (!normalized) return notifications;
    return notifications.filter(item =>
      item.message.toLowerCase().includes(normalized) ||
      item.module.toLowerCase().includes(normalized)
    );
  }, [notifications, notificationSearch]);

  async function deleteNotificationItem(id: number) {
    if (!canManageNotifications) return;

    try {
      await window.mooral.notifications.delete(id);
      await loadNotifications();
    } catch (error) {
      console.error("Failed to delete notification", error);
    }
  }

  async function resetNotificationHistory() {
    if (!canManageNotifications) return;

    if (!confirm("Clear all notification history? This cannot be undone.")) {
      return;
    }

    try {
      await window.mooral.notifications.reset();
      await loadNotifications();
    } catch (error) {
      console.error("Failed to reset notification history", error);
    }
  }

  useEffect(() => {
    let isMounted = true;

    async function loadDashboardData() {
      setIsLoading(true);
      setLoadError(null);

      try {
        const [customerData, productData, orderData] = await Promise.all([
          window.mooral.customers.getAll(),
          window.mooral.products.getAll(),
          window.mooral.orders.getAll()
        ]);

        if (!isMounted) return;

        setCustomers(customerData);
        setProducts(productData);
        setOrders(orderData);
      } catch (error) {
        console.error("Failed to load dashboard data", error);
        if (isMounted) {
          setLoadError("Could not load dashboard data. Please try again.");
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    loadDashboardData();

    return () => {
      isMounted = false;
    };
  }, []);

  const totalSales = useMemo(
    () => orders.reduce((sum, order) => sum + Number(order.total || 0), 0),
    [orders]
  );

  const totalOrders = orders.length;
  const totalCustomers = customers.length;
  const totalProducts = products.length;

  const lowStockProducts = useMemo(
    () => products.filter(product => Number(product.stock) <= 5),
    [products]
  );

  const recentOrders = useMemo(
    () => [...orders].reverse().slice(0, 5),
    [orders]
  );

  const topSellingProducts: TopProduct[] = useMemo(() => {
    const totals = orders.reduce((acc: Record<string, TopProduct>, order) => {
      if (!acc[order.product_name]) {
        acc[order.product_name] = { name: order.product_name, quantity: 0 };
      }
      acc[order.product_name].quantity += Number(order.quantity || 0);
      return acc;
    }, {});

    return Object.values(totals)
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 5);
  }, [orders]);

  const monthlySales = useMemo(() => buildMonthlySales(orders), [orders]);

  const hasSalesTrend = useMemo(
    () => monthlySales.some(point => point.sales > 0),
    [monthlySales]
  );

  // Presentation-only helper for the Y-axis tick labels of the Sales
  // Overview chart -- does not affect monthlySales itself or any
  // sales/revenue calculation, just how the axis abbreviates large
  // numbers so the labels fit without clipping.
  function formatCompactAxisValue(value: number): string {
    if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(0)}k`;
    return `${value}`;
  }

  /** Shows a placeholder instead of a misleading "0" while data is loading. */
  const statValue = (value: number) => (isLoading ? "—" : formatNumber(value));

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <div>
          <h1>{t("dashboard.title")}</h1>
          <p>{t("dashboard.subtitle")}</p>
        </div>
      </div>

      {loadError && (
        <div className="alert-row">
          <AlertTriangle size={20} />
          <span>{loadError}</span>
        </div>
      )}

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-top">
            <div>
              <span>{t("dashboard.totalSales")}</span>
              <h2>{isLoading ? "—" : formatCurrency(totalSales)}</h2>
            </div>
            <div className="icon-box blue">
              <DollarSign size={22} />
            </div>
          </div>
          <p className="success">{t("dashboard.totalSalesSubtitle")}</p>
        </div>

        <div className="stat-card">
          <div className="stat-top">
            <div>
              <span>{t("dashboard.orders")}</span>
              <h2>{statValue(totalOrders)}</h2>
            </div>
            <div className="icon-box green">
              <ShoppingCart size={22} />
            </div>
          </div>
          <p>{t("dashboard.ordersSubtitle")}</p>
        </div>

        <div className="stat-card">
          <div className="stat-top">
            <div>
              <span>{t("dashboard.customers")}</span>
              <h2>{statValue(totalCustomers)}</h2>
            </div>
            <div className="icon-box purple">
              <Users size={22} />
            </div>
          </div>
          <p>{t("dashboard.customersSubtitle")}</p>
        </div>

        <div className="stat-card">
          <div className="stat-top">
            <div>
              <span>{t("dashboard.products")}</span>
              <h2>{statValue(totalProducts)}</h2>
            </div>
            <div className="icon-box orange">
              <Package size={22} />
            </div>
          </div>
          <p className={lowStockProducts.length > 0 ? "warning" : "success"}>
            {isLoading
              ? "Checking stock levels..."
              : lowStockProducts.length > 0
                ? `${formatNumber(lowStockProducts.length)} low stock items`
                : "All stock levels healthy"}
          </p>
        </div>
      </div>

      <div className="dashboard-box">
        <div className="box-header">
          <h2>{t("dashboard.quickActions")}</h2>
          <span>{t("dashboard.quickActionsSubtitle")}</span>
        </div>

        <div className="quick-actions">
          <button onClick={() => navigate("/customers?action=add")}>
            <span className="qa-icon purple">
              <UserPlus size={18} />
            </span>
            Add Customer
          </button>

          <button onClick={() => navigate("/products?action=add")}>
            <span className="qa-icon orange">
              <Package size={18} />
            </span>
            Add Product
          </button>

          <button onClick={() => navigate("/orders?action=add")}>
            <span className="qa-icon green">
              <Plus size={18} />
            </span>
            Create Order
          </button>

          <button onClick={() => navigate("/invoices")}>
            <span className="qa-icon blue">
              <FileText size={18} />
            </span>
            View Invoices
          </button>
        </div>
      </div>

      {isOwner ? (

        <div className="dashboard-row">

          <div className="dashboard-box dashboard-box-top-products">
            <div className="box-header">
              <h2>{t("dashboard.topSellingProducts")}</h2>
            </div>

            {isLoading && (
              <div className="dashboard-box-empty">{t("dashboard.loadingTopProducts")}</div>
            )}

            {!isLoading && topSellingProducts.length === 0 && (
              <div className="dashboard-box-empty">{t("dashboard.noSalesData")}</div>
            )}

            {topSellingProducts.map((product, index) => (
              <div className="top-product-row" key={product.name}>
                <span className="rank-badge">{index + 1}</span>
                <strong>{product.name}</strong>
                <span>{formatNumber(product.quantity)} sold</span>
              </div>
            ))}
          </div>

          <div className="dashboard-box dashboard-box-notifications">
            <div className="box-header">
              <h2>{t("dashboard.notifications")}</h2>
              {canManageNotifications && notifications.length > 0 && (
                <button
                  className="notifications-reset-btn"
                  onClick={resetNotificationHistory}
                  title={t("dashboard.clearNotificationHistory")}
                >
                  <Trash2 size={14} />
                  Reset
                </button>
              )}
            </div>

            <div className="search-box notifications-search">
              <Search size={18} />
              <input
                type="text"
                placeholder={t("dashboard.searchNotifications")}
                value={notificationSearch}
                onChange={(e) => setNotificationSearch(e.target.value)}
              />
            </div>

            <div className="notifications-list">

              {filteredNotifications.length === 0 && (
                <div className="dashboard-box-empty">{t("dashboard.noNotifications")}</div>
              )}

              {filteredNotifications.map(item => (
                <div className="notification-row" key={item.id}>
                  <button
                    className="notification-row-main"
                    onClick={() => setSelectedNotification(item)}
                  >
                    <Bell size={14} />
                    <span>{item.message}</span>
                  </button>

                  {canManageNotifications && (
                    <button
                      className="notification-delete-btn"
                      onClick={() => deleteNotificationItem(item.id!)}
                      title={t("dashboard.deleteNotification")}
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              ))}

            </div>
          </div>

        </div>

      ) : isAdministrator ? (

        <div className="dashboard-row">

          <div className="dashboard-messages-slot-admin">
            <MessagesCard />
          </div>

          <div className="dashboard-box dashboard-box-notifications">
            <div className="box-header">
              <h2>{t("dashboard.notifications")}</h2>
              {canManageNotifications && notifications.length > 0 && (
                <button
                  className="notifications-reset-btn"
                  onClick={resetNotificationHistory}
                  title={t("dashboard.clearNotificationHistory")}
                >
                  <Trash2 size={14} />
                  Reset
                </button>
              )}
            </div>

            <div className="search-box notifications-search">
              <Search size={18} />
              <input
                type="text"
                placeholder={t("dashboard.searchNotifications")}
                value={notificationSearch}
                onChange={(e) => setNotificationSearch(e.target.value)}
              />
            </div>

            <div className="notifications-list">

              {filteredNotifications.length === 0 && (
                <div className="dashboard-box-empty">{t("dashboard.noNotifications")}</div>
              )}

              {filteredNotifications.map(item => (
                <div className="notification-row" key={item.id}>
                  <button
                    className="notification-row-main"
                    onClick={() => setSelectedNotification(item)}
                  >
                    <Bell size={14} />
                    <span>{item.message}</span>
                  </button>

                  {canManageNotifications && (
                    <button
                      className="notification-delete-btn"
                      onClick={() => deleteNotificationItem(item.id!)}
                      title={t("dashboard.deleteNotification")}
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              ))}

            </div>
          </div>

        </div>

      ) : (

        <div className="dashboard-row">

          <div className="dashboard-box dashboard-top-products-slot-employee">
            <div className="box-header">
              <h2>{t("dashboard.topSellingProducts")}</h2>
            </div>

            {isLoading && (
              <div className="dashboard-box-empty">{t("dashboard.loadingTopProducts")}</div>
            )}

            {!isLoading && topSellingProducts.length === 0 && (
              <div className="dashboard-box-empty">{t("dashboard.noSalesData")}</div>
            )}

            {topSellingProducts.map((product, index) => (
              <div className="top-product-row" key={product.name}>
                <span className="rank-badge">{index + 1}</span>
                <strong>{product.name}</strong>
                <span>{formatNumber(product.quantity)} sold</span>
              </div>
            ))}
          </div>

          <div className="dashboard-messages-slot-employee">
            <MessagesCard />
          </div>

        </div>

      )}

      <div className="dashboard-box">
        <div className="box-header">
          <h2>{t("dashboard.recentOrders")}</h2>
          <span>{t("dashboard.latestTransactions")}</span>
        </div>

        <div className="recent-orders-scroll">
          <div className="recent-orders-table">
            <div className="recent-order-row recent-order-head">
              <strong>{t("dashboard.orderId")}</strong>
              <strong>{t("common.customer")}</strong>
              <strong>{t("common.product")}</strong>
              <strong>{t("dashboard.amount")}</strong>
              <strong>{t("common.status")}</strong>
            </div>

            {isLoading && (
              <div className="dashboard-box-empty">{t("dashboard.loadingOrders")}</div>
            )}

            {!isLoading && recentOrders.length === 0 && (
              <div className="dashboard-box-empty">{t("dashboard.noOrders")}</div>
            )}

            {recentOrders.map(order => (
              <div className="recent-order-row" key={order.id ?? order.order_id}>
                <span className="cell-truncate" data-label="Order ID">{order.order_id}</span>
                <span className="cell-truncate" data-label="Customer">{order.customer_name}</span>
                <span className="cell-truncate" data-label="Product">{order.product_name}</span>
                <span data-label="Amount">{formatCurrency(order.total)}</span>
                <span className={statusClass(order.status)} data-label="Status">
                  {order.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="dashboard-box">
        <div className="box-header">
          <h2>{t("dashboard.salesOverview")}</h2>
          <span>Monthly Revenue (last 6 months, from real orders)</span>
        </div>

        {isLoading && <div className="chart-empty">{t("dashboard.loadingSalesTrend")}</div>}

        {!isLoading && !hasSalesTrend && (
          <div className="chart-empty">{t("dashboard.noSalesRecorded")}</div>
        )}

        {!isLoading && hasSalesTrend && (
          <div className="chart">
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={monthlySales} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
                <XAxis dataKey="month" tickLine={false} axisLine={{ stroke: "var(--border)" }} />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={56}
                  tickFormatter={formatCompactAxisValue}
                />
                <Tooltip
                  cursor={false}
                  formatter={(value) => [formatCurrency(Number(value ?? 0)), "Sales"]}
                />
                <Line
                  type="monotone"
                  dataKey="sales"
                  // Graphite Atelier: the trend line follows the theme accent
                  // instead of the old hardcoded blue, so it stays correct in
                  // both the dark and light palettes.
                  stroke="var(--chart-line)"
                  strokeWidth={2}
                  dot={{ r: 3, fill: "var(--chart-line)", strokeWidth: 0 }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {selectedNotification && (
        <div
          className="notification-modal-backdrop"
          onClick={() => setSelectedNotification(null)}
        >
          <div
            className="notification-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="notification-modal-header">
              <h2>{t("dashboard.notificationDetails")}</h2>
              <button
                className="notification-modal-close"
                onClick={() => setSelectedNotification(null)}
              >
                <X size={18} />
              </button>
            </div>

            <div className="notification-modal-body">
              <div className="notification-modal-row">
                <span>{t("dashboard.module")}</span>
                <strong>{selectedNotification.module}</strong>
              </div>

              <div className="notification-modal-row">
                <span>{t("dashboard.action")}</span>
                <strong>{selectedNotification.action}</strong>
              </div>

              <div className="notification-modal-row">
                <span>{t("dashboard.user")}</span>
                <strong>{selectedNotification.user || "—"}</strong>
              </div>

              <div className="notification-modal-row">
                <span>Date &amp; Time</span>
                <strong>
                  {selectedNotification.created_at
                    ? formatDateTime(selectedNotification.created_at)
                    : "—"}
                </strong>
              </div>

              <div className="notification-modal-row notification-modal-row-block">
                <span>{t("dashboard.before")}</span>
                <pre>{selectedNotification.before || "—"}</pre>
              </div>

              <div className="notification-modal-row notification-modal-row-block">
                <span>{t("dashboard.after")}</span>
                <pre>{selectedNotification.after || "—"}</pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
