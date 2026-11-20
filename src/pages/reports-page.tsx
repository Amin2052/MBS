import {
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import {
  Search,
  Download,
  FileSpreadsheet,
  FileText,
  Printer,
  RefreshCw
} from "lucide-react";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer
} from "recharts";

import "./reports.css";


import { getCompanySettings } from "@/services/company-settings-service";
import { renderReportHtml } from "@/pdf/templates/report-template";
import { MOORAL_LOGO_DATA_URL } from "@/assets/mooral-logo-data-url";
import { useCurrency } from "@/hooks/use-currency";
import { useAuth } from "@/hooks/use-auth";
import { useLanguage } from "@/hooks/use-language";
import { toast } from "@/components/toast/toast-store";
import { formatNumber as formatStockK } from "@/utils/format-number";
import ExcelJS from "exceljs";
import { showPrintPreview, buildPrintDocumentLabel } from "@/utils/print-window";

/* ==========================================================================
   TYPES
   ========================================================================== */

interface ReportSummary {
  totalInvoices: number;
  totalSalesValue: number;
  totalRevenue: number;
  totalPaid: number;
  totalDue: number;
  totalIncome: number;
  totalExpense: number;
  netProfit: number;
  balance: number;
  totalProducts: number;
  totalStock: number;
  inventoryValue: number;
}

interface SalesSummary {
  totalOrders: number;
  totalQuantity: number;
  averageOrderValue: number;
  highestOrderValue: number;
  lowestOrderValue: number;
}

interface SalesTrend {
  date: string;
  orders: number;
  quantity: number;
  sales: number;
}

interface InventoryStats {
  outOfStock: number;
  lowStock: number;
  highestStock: number;
  lowestStock: number;
}

interface ChartPoint {
  label: string;
  value: number;
}

type ReportStatus = "loading" | "error" | "live";

/* ==========================================================================
   CONSTANTS
   ========================================================================== */

const LOW_STOCK_THRESHOLD = 10;

const QUICK_FILTERS: { key: string; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "last7", label: "Last 7 Days" },
  { key: "last30", label: "Last 30 Days" },
  { key: "thisMonth", label: "This Month" },
  { key: "lastMonth", label: "Last Month" },
  { key: "thisYear", label: "This Year" },
  { key: "allTime", label: "All Time" }
];

// Display-only i18n key lookup for the constants above. The `label`
// field on QUICK_FILTERS/SECTION_FILTERS themselves stays plain English
// -- it's also used to build export filenames (buildExportFileName),
// and filenames should stay stable/ASCII regardless of UI language.
const QUICK_FILTER_I18N_KEYS: Record<string, string> = {
  today: "reports.quickToday",
  yesterday: "reports.quickYesterday",
  last7: "reports.quickLast7",
  last30: "reports.quickLast30",
  thisMonth: "reports.quickThisMonth",
  lastMonth: "reports.quickLastMonth",
  thisYear: "reports.quickThisYear",
  allTime: "reports.quickAllTime"
};

// Advanced filter: lets the user narrow the on-screen report to a single
// section instead of scrolling through every card/chart/table. "All
// Sections" (default) preserves the previous full-report behaviour.
const SECTION_FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "All Sections" },
  { key: "executive", label: "Executive Summary" },
  { key: "sales", label: "Sales" },
  { key: "inventory", label: "Inventory" },
  { key: "accounting", label: "Accounting" },
  { key: "certificates", label: "Certificates" }
];

const SECTION_FILTER_I18N_KEYS: Record<string, string> = {
  all: "reports.sectionAll",
  executive: "reports.sectionExecutive",
  sales: "reports.sectionSales",
  inventory: "reports.sectionInventory",
  accounting: "reports.sectionAccounting",
  certificates: "reports.sectionCertificates"
};

// Shared across every export format (CSV / Excel / PDF) so metadata stays
// identical no matter which button was clicked.
const COMPANY_NAME = "Mooral Business Suite";

const defaultSummary: ReportSummary = {
  totalInvoices: 0,
  totalSalesValue: 0,
  totalRevenue: 0,
  totalPaid: 0,
  totalDue: 0,
  totalIncome: 0,
  totalExpense: 0,
  netProfit: 0,
  balance: 0,
  totalProducts: 0,
  totalStock: 0,
  inventoryValue: 0
};

const defaultSalesSummary: SalesSummary = {
  totalOrders: 0,
  totalQuantity: 0,
  averageOrderValue: 0,
  highestOrderValue: 0,
  lowestOrderValue: 0
};

/* ==========================================================================
   HELPERS
   ========================================================================== */

function formatAmount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value || 0);
}

function formatDateLabel(value: string): string {
  if (!value || value === "Unknown") return "Unknown";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit"
  });
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function toISODate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function getQuickRange(key: string): { from: string; to: string } {
  const now = new Date();

  switch (key) {
    case "today": {
      const d = startOfDay(now);
      return { from: toISODate(d), to: toISODate(d) };
    }
    case "yesterday": {
      const d = new Date(now);
      d.setDate(d.getDate() - 1);
      const s = startOfDay(d);
      return { from: toISODate(s), to: toISODate(s) };
    }
    case "last7": {
      const end = startOfDay(now);
      const start = new Date(end);
      start.setDate(start.getDate() - 6);
      return { from: toISODate(start), to: toISODate(end) };
    }
    case "last30": {
      const end = startOfDay(now);
      const start = new Date(end);
      start.setDate(start.getDate() - 29);
      return { from: toISODate(start), to: toISODate(end) };
    }
    case "thisMonth": {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: toISODate(start), to: toISODate(startOfDay(now)) };
    }
    case "lastMonth": {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: toISODate(start), to: toISODate(end) };
    }
    case "thisYear": {
      const start = new Date(now.getFullYear(), 0, 1);
      return { from: toISODate(start), to: toISODate(startOfDay(now)) };
    }
    case "allTime":
    default:
      return { from: "", to: "" };
  }
}

function groupOrdersBy(orders: any[], mode: "day" | "week" | "month"): ChartPoint[] {
  const map: Record<string, number> = {};

  orders.forEach((order: any) => {
    if (!order.created_at) return;

    const dateStr = String(order.created_at).split(" ")[0];
    const parsed = new Date(dateStr);
    if (Number.isNaN(parsed.getTime())) return;

    let key = dateStr;

    if (mode === "week") {
      const day = new Date(parsed);
      const dayOfWeek = day.getDay();
      day.setDate(day.getDate() - dayOfWeek);
      key = toISODate(day);
    } else if (mode === "month") {
      key = `${parsed.getFullYear()}-${pad2(parsed.getMonth() + 1)}`;
    }

    map[key] = (map[key] || 0) + Number(order.total ?? 0);
  });

  return Object.keys(map)
    .sort()
    .map(key => ({ label: key, value: map[key] }));
}

function csvEscape(value: unknown): string {
  const str = String(value ?? "");
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function downloadBlob(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function downloadBinaryBlob(content: ArrayBuffer, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/* ==========================================================================
   CHARTS
   All report chart cards render trend/comparison data as Line Charts using
   recharts — the same chart library already used on the Dashboard — for a
   consistent, professional look across the app.
   ========================================================================== */

function ChartEmptyState() {
  const { t } = useLanguage();
  return <div className="chart-empty">{t("reports.noDataForPeriod")}</div>;
}

function MiniLineChart({ data, color = "var(--primary, #2563eb)" }: { data: ChartPoint[]; color?: string }) {
  if (!data.length) return <ChartEmptyState />;

  return (
    <div className="mini-chart">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10 }}
            tickLine={false}
            axisLine={{ stroke: "var(--border, #e5e7eb)" }}
            interval="preserveStartEnd"
            minTickGap={20}
          />
          <YAxis
            tick={{ fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            width={34}
          />
          <Tooltip
            formatter={(value) => [formatAmount(Number(value)), "Amount"]}
            labelFormatter={(label) => String(label)}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            dot={{ r: 3 }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ==========================================================================
   MAIN COMPONENT
   ========================================================================== */

export default function ReportsPage(): JSX.Element {

  const { format: formatCurrency } = useCurrency();
  const { hasPermission } = useAuth();
  const { t } = useLanguage();

  const [summary, setSummary] = useState<ReportSummary>(defaultSummary);
  const [salesSummary, setSalesSummary] = useState<SalesSummary>(defaultSalesSummary);
  const [salesTrend, setSalesTrend] = useState<SalesTrend[]>([]);
  const [rawOrders, setRawOrders] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [certificates, setCertificates] = useState<any[]>([]);
  const [certificateSummary, setCertificateSummary] = useState<any>(null);
  const [accountingTransactions, setAccountingTransactions] = useState<any[]>([]);

  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [activeQuickFilter, setActiveQuickFilter] = useState("allTime");
  const [sectionFilter, setSectionFilter] = useState("all");

  // Export race-condition guard (SHOULD FIX #3): exportingFormat drives the
  // disabled UI state, while the ref gives an immediate, synchronous lock
  // so a rapid double-click can't slip through before React re-renders.
  const [exportingFormat, setExportingFormat] = useState<null | "csv" | "excel" | "pdf" | "print">(null);
  const isExportingRef = useRef(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  // Until the first load resolves every total is still its 0 initial value, so
  // the cards used to read "Total Sales 0.00" for a second and look like an
  // empty business rather than a page that is still fetching. Show a dash
  // instead, and only on that first load: a later refresh keeps the previous
  // numbers on screen rather than blanking them.
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const pendingFirstLoad = loading && !hasLoadedOnce;

  // Company profile (name + logo) for the printable/on-screen-print report
  // header (see the .printable-report block below). This is the same data
  // buildReportHtmlNew() already uses for the direct PDF export; the plain
  // and a generic company name instead of the user's actual profile.
  const [printCompanyName, setPrintCompanyName] = useState(COMPANY_NAME);
  const [printLogoDataUrl, setPrintLogoDataUrl] = useState<string | null>(null);

  async function loadReports(overrideFrom?: string, overrideTo?: string) {
    const effectiveFrom = overrideFrom ?? fromDate;
    const effectiveTo = overrideTo ?? toDate;

    setLoading(true);
    setError(null);

    try {
      const api = (window as any).mooral;

      if (!api) {
        setError(t("reports.bridgeUnavailable"));
        setLoading(false);
        return;
      }

      const invoiceSummary = api.invoices?.summary ? await api.invoices.summary() : {};
      const accountingSummary = api.accounting?.summary
        ? await api.accounting.summary({ fromDate: effectiveFrom, toDate: effectiveTo })
        : {};
      const accountingList = api.accounting?.get
        ? await api.accounting.get({ fromDate: effectiveFrom, toDate: effectiveTo })
        : [];
      const productList = api.products?.getAll ? await api.products.getAll() : [];
      const orderList = api.orders?.getAll
        ? await api.orders.getAll({ fromDate: effectiveFrom, toDate: effectiveTo })
        : [];
      const certificateList = api.certificates?.getAll ? await api.certificates.getAll() : [];
      const certificateSummaryData = api.certificates?.summary ? await api.certificates.summary() : null;

      const safeProducts = Array.isArray(productList) ? productList : [];
      const safeOrders = Array.isArray(orderList) ? orderList : [];

      let stock = 0;
      let inventoryValue = 0;

      safeProducts.forEach((item: any) => {
        stock += Number(item.stock ?? 0);
        inventoryValue += Number(item.stock ?? 0) * Number(item.price ?? 0);
      });

      let totalOrders = 0;
      let totalQuantity = 0;
      let totalSalesValue = 0;
      let highestOrderValue = 0;
      let lowestOrderValue = Number.POSITIVE_INFINITY;

      const trendMap: Record<string, SalesTrend> = {};

      safeOrders.forEach((order: any) => {
        const orderTotal = Number(order.total ?? 0);

        totalOrders += 1;
        totalQuantity += Number(order.quantity ?? 0);
        totalSalesValue += orderTotal;

        if (orderTotal > highestOrderValue) highestOrderValue = orderTotal;
        if (orderTotal < lowestOrderValue) lowestOrderValue = orderTotal;

        const date = order.created_at ? String(order.created_at).split(" ")[0] : "Unknown";

        if (!trendMap[date]) {
          trendMap[date] = { date, orders: 0, quantity: 0, sales: 0 };
        }

        trendMap[date].orders += 1;
        trendMap[date].quantity += Number(order.quantity ?? 0);
        trendMap[date].sales += orderTotal;
      });

      setRawOrders(safeOrders);
      setProducts(safeProducts);
      setSalesTrend(Object.values(trendMap));
      setCertificates(Array.isArray(certificateList) ? certificateList : []);
      setCertificateSummary(certificateSummaryData);
      setAccountingTransactions(Array.isArray(accountingList) ? accountingList : []);

      setSalesSummary({
        totalOrders,
        totalQuantity,
        averageOrderValue: totalOrders > 0 ? totalSalesValue / totalOrders : 0,
        highestOrderValue,
        lowestOrderValue: totalOrders > 0 ? lowestOrderValue : 0
      });

      const totalIncome = Number(accountingSummary?.totalIncome ?? 0);
      const totalExpense = Number(accountingSummary?.totalExpense ?? 0);

      setSummary({
        totalInvoices: Number(invoiceSummary?.totalInvoices ?? 0),
        totalSalesValue,
        totalRevenue: Number(invoiceSummary?.totalAmount ?? 0),
        totalPaid: Number(invoiceSummary?.totalPaid ?? 0),
        totalDue: Number(invoiceSummary?.totalDue ?? 0),
        totalIncome,
        totalExpense,
        netProfit: totalIncome - totalExpense,
        balance: Number(accountingSummary?.balance ?? 0),
        totalProducts: safeProducts.length,
        totalStock: stock,
        inventoryValue
      });

      setLastUpdated(new Date());
      setHasLoadedOnce(true);

    } catch (err) {
      console.error("REPORT ERROR:", err);
      setError(t("reports.loadFailed"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadReports();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const company = await getCompanySettings();
        if (cancelled) return;

        setPrintCompanyName(company.companyName || COMPANY_NAME);

        const logo = company.logoPath
          ? await window.mooral.settings.getLogoPreview(company.logoPath)
          : null;

        if (!cancelled) setPrintLogoDataUrl(logo ?? MOORAL_LOGO_DATA_URL);
      } catch (err) {
        console.error("Failed to load company profile for report print header:", err);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  function applyQuickFilter(key: string) {
    setActiveQuickFilter(key);
    const range = getQuickRange(key);
    setFromDate(range.from);
    setToDate(range.to);
    loadReports(range.from, range.to);
  }

  function applyManualFilter() {
    setActiveQuickFilter("custom");
    loadReports();
  }

  /* ------------------------------------------------------------------
     DERIVED / MEMOIZED DATA
     ------------------------------------------------------------------ */

  const keyword = search.trim().toLowerCase();

  function matchesSearch(title: string): boolean {
    return !keyword || title.toLowerCase().includes(keyword);
  }

  function showSection(key: string): boolean {
    return sectionFilter === "all" || sectionFilter === key;
  }

  const executiveCards = useMemo(() => ([
    { title: t("reports.totalSales"), value: formatCurrency(summary.totalSalesValue) },
    { title: t("reports.totalRevenue"), value: formatCurrency(summary.totalRevenue) },
    { title: t("reports.totalPaid"), value: formatCurrency(summary.totalPaid) },
    { title: t("reports.totalDue"), value: formatCurrency(summary.totalDue) },
    { title: t("reports.totalIncome"), value: formatCurrency(summary.totalIncome) },
    { title: t("reports.totalExpense"), value: formatCurrency(summary.totalExpense) },
    { title: t("reports.netProfit"), value: formatCurrency(summary.netProfit) },
    { title: t("reports.currentBalance"), value: formatCurrency(summary.balance) },
    { title: t("reports.totalOrders"), value: String(salesSummary.totalOrders) },
    { title: t("reports.totalProducts"), value: String(summary.totalProducts) },
    { title: t("reports.totalStock"), value: formatStockK(summary.totalStock) },
    { title: t("reports.inventoryValue"), value: formatCurrency(summary.inventoryValue) }
  ]), [summary, salesSummary, formatCurrency, t]);

  const filteredExecutiveCards = useMemo(
    () => executiveCards.filter(card => matchesSearch(card.title)),
    [executiveCards, keyword]
  );

  const salesAnalyticsCards = useMemo(() => ([
    { title: t("reports.totalOrders"), value: String(salesSummary.totalOrders) },
    { title: t("reports.totalQuantitySold"), value: formatAmount(salesSummary.totalQuantity) },
    { title: t("reports.averageOrderValue"), value: formatCurrency(salesSummary.averageOrderValue) },
    { title: t("reports.highestOrderValue"), value: formatCurrency(salesSummary.highestOrderValue) },
    { title: t("reports.lowestOrderValue"), value: formatCurrency(salesSummary.lowestOrderValue) }
  ]), [salesSummary, formatCurrency, t]);

  const filteredSalesAnalyticsCards = useMemo(
    () => salesAnalyticsCards.filter(card => matchesSearch(card.title)),
    [salesAnalyticsCards, keyword]
  );

  const dailySales = useMemo(() => groupOrdersBy(rawOrders, "day").slice(-14), [rawOrders]);
  const weeklySales = useMemo(() => groupOrdersBy(rawOrders, "week").slice(-12), [rawOrders]);
  const monthlySales = useMemo(() => groupOrdersBy(rawOrders, "month").slice(-12), [rawOrders]);

  // PHASE 10 UI AUDIT FIX: report-template.ts's PDF "Order Status" table
  // used to be hardcoded fake data (literal "Pending: 41, 3.2%" /
  // "Cancelled: 37, 2.9%" constants, unrelated to any real order in the
  // database). rawOrders (already loaded by loadReports() above) carries
  // each order's real `status` field ("Pending" / "Completed" /
  // "Cancelled", per order-repository.ts and orders-page.tsx's own status
  // dropdown), so the real breakdown is derived here instead of
  // fabricated in the template.
  const orderStatusBreakdown = useMemo(() => {
    let completed = 0, pending = 0, cancelled = 0, other = 0;

    rawOrders.forEach((order: any) => {
      switch (order.status) {
        case "Completed": completed += 1; break;
        case "Pending": pending += 1; break;
        case "Cancelled": cancelled += 1; break;
        default: other += 1; break;
      }
    });

    const total = rawOrders.length;
    const share = (count: number) => total ? `${((count / total) * 100).toFixed(1)}%` : "0.0%";

    const rows = [
      { label: t("orders.completed"), value: completed, share: share(completed), interpretation: t("reports.interpretationHealthy") },
      { label: t("orders.pending"), value: pending, share: share(pending), interpretation: t("reports.interpretationMonitor") },
      { label: t("orders.cancelled"), value: cancelled, share: share(cancelled), interpretation: t("reports.interpretationReview") }
    ];

    // Only surface an "Other" row if the data actually contains a status
    // value outside the three known ones -- keeps the table matching its
    // pre-existing three-row layout for every real installation, while
    // still accounting for every order rather than silently dropping any.
    if (other > 0) {
      rows.push({ label: t("reports.statusOther"), value: other, share: share(other), interpretation: t("reports.interpretationReview") });
    }

    return rows;
  }, [rawOrders, t]);

  const certificatesByMonth: ChartPoint[] = useMemo(() => {
    const map: Record<string, number> = {};
    certificates.forEach((cert: any) => {
      if (!cert.issue_date) return;
      const parsed = new Date(String(cert.issue_date).split(" ")[0]);
      if (Number.isNaN(parsed.getTime())) return;
      const key = parsed.getFullYear() + "-" + String(parsed.getMonth() + 1).padStart(2, "0");
      map[key] = (map[key] || 0) + 1;
    });
    return Object.keys(map).sort().slice(-12).map(key => ({ label: key, value: map[key] }));
  }, [certificates]);

  const certificatesByCustomer: ChartPoint[] = useMemo(() => {
    const map: Record<string, number> = {};
    certificates.forEach((cert: any) => {
      const name = cert.certificate_category === "Employee"
        ? cert.employee_name
        : cert.customer_name;
      if (!name) return;
      map[name] = (map[name] || 0) + 1;
    });
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([label, value]) => ({ label, value }));
  }, [certificates]);

  const salesTrendSorted = useMemo(() => {
    return [...salesTrend].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }, [salesTrend]);

  const filteredSalesTrend = useMemo(() => {
    if (!keyword) return salesTrendSorted;
    return salesTrendSorted.filter(row =>
      row.date.toLowerCase().includes(keyword) ||
      String(row.orders).includes(keyword) ||
      String(row.quantity).includes(keyword) ||
      String(row.sales).includes(keyword)
    );
  }, [salesTrendSorted, keyword]);

  const inventoryStats: InventoryStats = useMemo(() => {
    if (!products.length) {
      return { outOfStock: 0, lowStock: 0, highestStock: 0, lowestStock: 0 };
    }

    let outOfStock = 0;
    let lowStock = 0;
    let highestStock = Number.NEGATIVE_INFINITY;
    let lowestStock = Number.POSITIVE_INFINITY;

    products.forEach((item: any) => {
      const stock = Number(item.stock ?? 0);
      if (stock <= 0) outOfStock += 1;
      else if (stock <= LOW_STOCK_THRESHOLD) lowStock += 1;
      if (stock > highestStock) highestStock = stock;
      if (stock < lowestStock) lowestStock = stock;
    });

    return {
      outOfStock,
      lowStock,
      highestStock: highestStock === Number.NEGATIVE_INFINITY ? 0 : highestStock,
      lowestStock: lowestStock === Number.POSITIVE_INFINITY ? 0 : lowestStock
    };
  }, [products]);

  const inventoryCards = useMemo(() => ([
    { title: t("reports.totalProducts"), value: String(summary.totalProducts) },
    { title: t("reports.totalStock"), value: formatStockK(summary.totalStock) },
    { title: t("reports.inventoryValue"), value: formatCurrency(summary.inventoryValue) },
    { title: t("reports.outOfStock"), value: String(inventoryStats.outOfStock) },
    { title: t("reports.lowStock"), value: String(inventoryStats.lowStock) },
    { title: t("reports.highestStock"), value: formatStockK(inventoryStats.highestStock) },
    { title: t("reports.lowestStock"), value: formatStockK(inventoryStats.lowestStock) }
  ]), [summary, inventoryStats, formatCurrency, t]);

  const filteredInventoryCards = useMemo(
    () => inventoryCards.filter(card => matchesSearch(card.title)),
    [inventoryCards, keyword]
  );

  const topProductsByStock = useMemo(() => {
    return [...products]
      .sort((a: any, b: any) => Number(b.stock ?? 0) - Number(a.stock ?? 0))
      .slice(0, 5)
      .map((p: any) => ({ label: p.name ?? p.product_id ?? "Item", value: Number(p.stock ?? 0) }));
  }, [products]);

  const monthlyAccounting = useMemo(() => {
    const map: Record<string, { income: number; expense: number }> = {};
    accountingTransactions.forEach((tx: any) => {
      const raw = String(tx.transaction_date ?? tx.created_at ?? "").split(" ")[0];
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) return;
      const key = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
      if (!map[key]) map[key] = { income: 0, expense: 0 };
      const amount = Number(tx.amount ?? 0);
      if (tx.type === "Income") map[key].income += amount;
      else if (tx.type === "Expense") map[key].expense += amount;
    });
    return Object.keys(map).sort().slice(-12).map(key => ({
      label: key,
      income: map[key].income,
      expense: map[key].expense,
      profit: map[key].income - map[key].expense
    }));
  }, [accountingTransactions]);

  const accountingCards = useMemo(() => ([
    { title: t("reports.income"), value: formatCurrency(summary.totalIncome) },
    { title: t("reports.expense"), value: formatCurrency(summary.totalExpense) },
    { title: t("reports.profit"), value: formatCurrency(summary.netProfit) },
    { title: t("reports.balance"), value: formatCurrency(summary.balance) },
    { title: t("reports.outstandingDue"), value: formatCurrency(summary.totalDue) }
  ]), [summary, formatCurrency, t]);

  const filteredAccountingCards = useMemo(
    () => accountingCards.filter(card => matchesSearch(card.title)),
    [accountingCards, keyword]
  );

  const revenueChartData: ChartPoint[] = useMemo(() => ([
    { label: "Revenue", value: summary.totalRevenue },
    { label: "Paid", value: summary.totalPaid },
    { label: "Due", value: summary.totalDue }
  ]), [summary]);

  const expenseChartData: ChartPoint[] = useMemo(() => ([
    { label: "Income", value: summary.totalIncome },
    { label: "Expense", value: summary.totalExpense },
    { label: "Profit", value: summary.netProfit }
  ]), [summary]);

  const activeFiltersLabel = fromDate || toDate
    ? `${fromDate || "…"} to ${toDate || "…"}`
    : t("reports.quickAllTime");

  const reportStatus: ReportStatus = loading ? "loading" : error ? "error" : "live";

  const reportOverviewCards = useMemo(() => ([
    { title: t("reports.generatedDate"), value: new Date().toLocaleDateString() },
    { title: t("reports.lastUpdated"), value: lastUpdated ? lastUpdated.toLocaleString() : "—" },
    { title: t("reports.activeFilters"), value: activeFiltersLabel },
    { title: t("reports.totalRecords"), value: String(salesTrend.reduce((sum, row) => sum + row.orders, 0)) },
    { title: t("reports.dataSources"), value: t("reports.dataSourcesValue") },
    { title: t("reports.reportStatus"), value: reportStatus === "live" ? t("reports.statusLive") : reportStatus === "loading" ? t("reports.statusLoading") : t("reports.statusError") }
  ]), [lastUpdated, activeFiltersLabel, salesTrend, reportStatus, t]);

  /* ------------------------------------------------------------------
     EXPORT DATA (memoized)
     Built once per relevant state change instead of being recomputed
     from scratch inside every export click -- CSV, Excel, and PDF all
     read from the same pre-processed structures below (IMPROVEMENT #5 /
     SHOULD FIX #4: avoids repeated filtering/mapping over the same
     dataset for large reports).
     ------------------------------------------------------------------ */

  interface ReportExportSection {
    title: string;
    rows: { label: string; value: string }[];
  }

  const reportExportSections: ReportExportSection[] = useMemo(() => {
    const sections: ReportExportSection[] = [];

    if (showSection("executive") && filteredExecutiveCards.length) {
      sections.push({
        title: t("reports.sectionExecutive"),
        rows: filteredExecutiveCards.map(c => ({ label: c.title, value: c.value }))
      });
    }

    if (showSection("sales") && filteredSalesAnalyticsCards.length) {
      sections.push({
        title: t("reports.salesAnalytics"),
        rows: filteredSalesAnalyticsCards.map(c => ({ label: c.title, value: c.value }))
      });
    }

    if (showSection("inventory") && filteredInventoryCards.length) {
      sections.push({
        title: t("reports.inventoryAnalytics"),
        rows: filteredInventoryCards.map(c => ({ label: c.title, value: c.value }))
      });
    }

    if (showSection("accounting") && filteredAccountingCards.length) {
      sections.push({
        title: t("reports.accountingSummary"),
        rows: filteredAccountingCards.map(c => ({ label: c.title, value: c.value }))
      });
    }

    if (showSection("certificates")) {
      sections.push({
        title: t("reports.certificates"),
        rows: [
          { label: t("reports.employeeCertificates"), value: String(certificateSummary?.employeeCount ?? 0) },
          { label: t("reports.productCertificates"), value: String(certificateSummary?.productCount ?? 0) },
          { label: t("reports.certificatesNearExpiry"), value: String(certificateSummary?.nearExpiryCount ?? 0) },
          {
            label: t("reports.expiredCertificates"),
            value: String((certificateSummary?.expiredCount ?? 0) + (certificateSummary?.overdueExpiredCount ?? 0))
          }
        ]
      });
    }

    return sections;
  }, [
    sectionFilter,
    filteredExecutiveCards,
    filteredSalesAnalyticsCards,
    filteredInventoryCards,
    filteredAccountingCards,
    certificateSummary,
    t
  ]);

  // Sales-trend rows pre-formatted once for reuse across CSV/Excel
  // (respects the active search filter) and the full PDF export (does not
  // -- the exported PDF file is always the complete report).
  const exportSalesTrendRows = useMemo(
    () => filteredSalesTrend.map(row => ({
      date: formatDateLabel(row.date),
      orders: row.orders,
      quantity: row.quantity,
      sales: row.sales
    })),
    [filteredSalesTrend]
  );

  // PDF-only aggregation: the on-screen Reports page keeps the complete
  // date-level dataset, while the PDF uses one row per calendar month so
  // long date-level reports do not become unnecessarily large.
  const pdfMonthlySalesTrendRows = useMemo(() => {
    const monthly = new Map<string, { orders: number; quantity: number; sales: number }>();

    salesTrendSorted.forEach(row => {
      if (!row.date || row.date === "Unknown") return;
      const parsed = new Date(row.date);
      if (Number.isNaN(parsed.getTime())) return;

      const key = `${parsed.getFullYear()}-${pad2(parsed.getMonth() + 1)}`;
      const current = monthly.get(key) ?? { orders: 0, quantity: 0, sales: 0 };
      current.orders += Number(row.orders) || 0;
      current.quantity += Number(row.quantity) || 0;
      current.sales += Number(row.sales) || 0;
      monthly.set(key, current);
    });

    return Array.from(monthly.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, values]) => {
        const [year, month] = key.split("-").map(Number);
        const monthLabel = new Date(year, month - 1, 1).toLocaleDateString("en-US", {
          year: "numeric",
          month: "short"
        });

        return {
          date: monthLabel,
          orders: values.orders,
          quantity: values.quantity,
          salesFormatted: formatCurrency(values.sales),
          salesRaw: values.sales
        };
      });
  }, [salesTrendSorted, formatCurrency]);

  // Single source of truth for export metadata (IMPROVEMENT #9): company
  // name, date range, and a single "generated at" timestamp shared by
  // every export format triggered from the same click, instead of each
  // format independently calling `new Date()`.
  function getReportMetadata() {
    const generatedAt = new Date();
    return {
      companyName: COMPANY_NAME,
      dateRangeLabel: activeFiltersLabel,
      generatedAtLabel: generatedAt.toLocaleString(),
      generatedAt
    };
  }

  // IMPROVEMENT #10: default export filenames now include the active
  // section and date range/generation date, e.g. "Sales_Report_2026-08-07"
  // or "Inventory_Report_2026-07-01_to_2026-07-31", instead of a fixed
  // generic name every time.
  function buildExportFileName(extension: string): string {
    const sectionLabel = (SECTION_FILTERS.find(f => f.key === sectionFilter)?.label ?? "Business_Performance")
      .replace(/\s+/g, "_");

    const dateStamp = fromDate || toDate
      ? (fromDate && toDate && fromDate !== toDate ? `${fromDate}_to_${toDate}` : (fromDate || toDate))
      : toISODate(new Date());

    return `${sectionLabel}_Report_${dateStamp}.${extension}`;
  }

  /* ------------------------------------------------------------------
     EXPORT HANDLERS
     Advanced exports cover the full report (respecting the active
     section filter + search), not just the sales trend table.
     ------------------------------------------------------------------ */

  function exportCSV() {
    if (isExportingRef.current) return;
    isExportingRef.current = true;
    setExportingFormat("csv");

    try {
      const meta = getReportMetadata();
      const lines: string[] = [];

      lines.push([csvEscape(`${meta.companyName}${t("reports.csvReportTitleSuffix")}`)].join(","));
      lines.push([csvEscape(t("reports.csvDateRange")), csvEscape(meta.dateRangeLabel)].join(","));
      lines.push([csvEscape(t("reports.csvGenerated")), csvEscape(meta.generatedAtLabel)].join(","));
      lines.push("");

      reportExportSections.forEach(section => {
        lines.push([csvEscape(section.title)].join(","));
        section.rows.forEach(row => {
          lines.push([csvEscape(row.label), csvEscape(row.value)].join(","));
        });
        lines.push("");
      });

      if (showSection("sales")) {
        lines.push([csvEscape(t("reports.salesTrend"))].join(","));
        lines.push([t("common.date"), t("reports.tableOrdersHeader"), t("orders.quantity"), t("reports.tableSalesHeader")].map(csvEscape).join(","));
        exportSalesTrendRows.forEach(row => {
          lines.push([row.date, row.orders, row.quantity, row.sales].map(csvEscape).join(","));
        });
      }

      // Leading BOM so Excel/Sheets correctly detect UTF-8 (needed for
      // non-Latin currency symbols such as ﷼ and other non-Latin text
      // in card titles/values).
      downloadBlob("\ufeff" + lines.join("\n"), buildExportFileName("csv"), "text/csv;charset=utf-8;");
    } finally {
      isExportingRef.current = false;
      setExportingFormat(null);
    }
  }

  async function exportExcel() {
    if (isExportingRef.current) return;
    isExportingRef.current = true;
    setExportingFormat("excel");

    try {
      const meta = getReportMetadata();

      const workbook = new ExcelJS.Workbook();

      // Summary sheet: one row per metric across every report section
      // (Executive Summary, Sales Analytics, Inventory Analytics,
      // Accounting Summary), matching what's shown on screen / in the PDF.
      const summarySheet = workbook.addWorksheet("Summary");
      summarySheet.columns = [
        { header: "Metric", width: 28 },
        { header: "Value", width: 24 }
      ];

      summarySheet.addRow([`${meta.companyName}${t("reports.csvReportTitleSuffix")}`]);
      summarySheet.addRow([t("reports.csvDateRange"), meta.dateRangeLabel]);
      summarySheet.addRow([t("reports.csvGenerated"), meta.generatedAtLabel]);
      summarySheet.addRow([]);

      reportExportSections.forEach(section => {
        summarySheet.addRow([section.title]);
        section.rows.forEach(row => {
          summarySheet.addRow([row.label, row.value]);
        });
        summarySheet.addRow([]);
      });

      // Sales Trend sheet: a real tabular sheet with headers, so the
      // numbers (orders/quantity/sales) stay usable in Excel formulas
      // instead of being locked inside pre-formatted display strings.
      if (showSection("sales")) {
        const salesSheet = workbook.addWorksheet("Sales Trend");
        salesSheet.columns = [
          { header: t("common.date"), width: 14 },
          { header: t("reports.tableOrdersHeader"), width: 10 },
          { header: t("orders.quantity"), width: 10 },
          { header: t("reports.tableSalesHeader"), width: 16 }
        ];

        exportSalesTrendRows.forEach(row => {
          salesSheet.addRow([row.date, row.orders, row.quantity, row.sales]);
        });
      }

      const workbookBinary = await workbook.xlsx.writeBuffer();

      downloadBinaryBlob(
        workbookBinary,
        buildExportFileName("xlsx"),
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
    } finally {
      isExportingRef.current = false;
      setExportingFormat(null);
    }
  }


  // Gathers report data via getReportMetadata() (four fixed card
  // sections, unfiltered sales trend data - the PDF export does not
  // respect the on-screen search/section filters), fetches the
  // company logo, and hands it to renderReportHtml() to build the
  // markup.
  async function buildReportHtmlNew(): Promise<string> {

    const meta = getReportMetadata();
    const company = await getCompanySettings();
    const logoData = (company.logoPath
      ? await window.mooral.settings.getLogoPreview(company.logoPath)
      : null) ?? MOORAL_LOGO_DATA_URL;

    // PHASE 10 UI AUDIT FIX: `renderReportHtml()` used to look these
    // sections up by `.find(s => s.title === "Executive Summary")` --
    // an English literal. Since `title` here is now translated via
    // `t()` (part of this session's i18n work), that match would
    // silently fail for bn/ar, leaving the Executive/Sales/Accounting
    // KPI cards empty on every non-English PDF. `key` is a stable,
    // never-translated identifier for `report-template.ts` to match
    // on; `title` remains the localized display text.
    const sections: { key: string; title: string; cards: typeof executiveCards }[] = [
      { key: "executive", title: t("reports.sectionExecutive"), cards: executiveCards },
      { key: "sales", title: t("reports.salesAnalytics"), cards: salesAnalyticsCards },
      { key: "inventory", title: t("reports.inventoryAnalytics"), cards: inventoryCards },
      { key: "accounting", title: t("reports.accountingSummary"), cards: accountingCards }
    ];

    const toChartPoints = (items: ChartPoint[]) => items.map(p => ({
      label: p.label,
      value: Number(p.value) || 0,
      valueFormatted: formatAmount(Number(p.value) || 0)
    }));

    // PDF intentionally uses monthly aggregation. The live Reports screen
    // remains date-level and is not changed by this export-only rule.
    const salesTrendRows = pdfMonthlySalesTrendRows;

    return renderReportHtml({
      companyName: company.companyName || meta.companyName,
      companyPhone: company.phone,
      companyEmail: company.email,
      companyAddress: company.address,
      companyWebsite: company.website,
      companyTaxId: company.taxId,
      logoDataUrl: logoData,
      reportTitle: t("reports.businessPerformanceReportTitle"),
      reportLabel: t("reports.reportsAndAnalyticsLabel"),
      dateRangeLabel: meta.dateRangeLabel,
      generatedAtLabel: meta.generatedAtLabel,
      sections,
      // All PDF sales trend charts are monthly to keep the exported report
      // compact and management-friendly. The on-screen charts remain unchanged.
      dailySales: toChartPoints(monthlySales),
      weeklySales: toChartPoints(monthlySales),
      monthlySales: toChartPoints(monthlySales),
      salesTrendRows,
      topProductsChart: toChartPoints(topProductsByStock),
      revenueChartData: toChartPoints(revenueChartData),
      expenseChartData: toChartPoints(expenseChartData),
      monthlyIncome: monthlyAccounting.map(p => ({ label: p.label, value: p.income })),
      monthlyExpense: monthlyAccounting.map(p => ({ label: p.label, value: p.expense })),
      monthlyProfit: monthlyAccounting.map(p => ({ label: p.label, value: p.profit })),
      inventoryStats: inventoryCards,
      inventoryStatus: [
        { label: t("reports.inStock"), value: Math.max(0, summary.totalProducts - inventoryStats.lowStock - inventoryStats.outOfStock), share: summary.totalProducts ? `${((Math.max(0, summary.totalProducts - inventoryStats.lowStock - inventoryStats.outOfStock) / summary.totalProducts) * 100).toFixed(1)}%` : "0.0%" },
        { label: t("reports.lowStock"), value: inventoryStats.lowStock, share: summary.totalProducts ? `${((inventoryStats.lowStock / summary.totalProducts) * 100).toFixed(1)}%` : "0.0%" },
        { label: t("reports.outOfStock"), value: inventoryStats.outOfStock, share: summary.totalProducts ? `${((inventoryStats.outOfStock / summary.totalProducts) * 100).toFixed(1)}%` : "0.0%" }
      ],
      certificatesByMonth: toChartPoints(certificatesByMonth),
      certificatesByCustomer: toChartPoints(certificatesByCustomer),
      certificateCards: [
        { title: t("reports.employeeCertificates"), value: String(certificateSummary?.employeeCount ?? 0) },
        { title: t("reports.productCertificates"), value: String(certificateSummary?.productCount ?? 0) },
        { title: t("reports.certificatesNearExpiry"), value: String(certificateSummary?.nearExpiryCount ?? 0) },
        { title: t("reports.expiredCertificates"), value: String((certificateSummary?.expiredCount ?? 0) + (certificateSummary?.overdueExpiredCount ?? 0)) }
      ],
      reportOverview: reportOverviewCards,
      orderStatusBreakdown,
      labels: {
        erpSubtitle: t("reports.printSubtitle"),
        companyProfileFallback: t("reports.companyProfileFallback"),
        periodLabel: t("reports.printDateRangeLabel"),
        generatedLabel: t("reports.printGeneratedLabel"),
        footerAutoGenerated: t("reports.footerAutoGenerated"),
        pageWord: t("reports.pageWord"),
        businessMetric: t("reports.businessMetric"),
        operationalMetric: t("reports.operationalMetric"),
        pageExecutiveSummary: t("reports.sectionExecutive"),
        pageSalesAnalytics: t("reports.salesAnalytics"),
        pageChartsAndTrends: t("reports.chartsAndTrends"),
        pageInventoryAnalytics: t("reports.inventoryAnalytics"),
        pageAccountingSummary: t("reports.accountingSummary"),
        pageCertificates: t("reports.certificates"),
        pageReportOverviewOperational: t("reports.pageReportOverviewOperational"),
        pageVerificationExportSummary: t("reports.pageVerificationExportSummary"),
        sectionFinancialComposition: t("reports.sectionFinancialComposition"),
        sectionSalesTrend: t("reports.salesTrend"),
        sectionInventoryStatus: t("reports.sectionInventoryStatus"),
        sectionCertificateMonitoring: t("reports.sectionCertificateMonitoring"),
        sectionTopProductsByStock: t("reports.sectionTopProductsByStock"),
        sectionOrderStatus: t("reports.sectionOrderStatus"),
        sectionReportOverview: t("reports.reportOverview"),
        chartRevenuePaidDue: t("reports.chartRevenuePaidDue"),
        chartIncomeExpenseProfit: t("reports.chartIncomeExpenseProfit"),
        chartDailySalesLast14: t("reports.chartDailySalesLast14"),
        chartWeeklySalesLast12: t("reports.chartWeeklySalesLast12"),
        chartMonthlySalesLast12: t("reports.chartMonthlySalesLast12"),
        chartSalesLineChart: t("reports.salesLineChart"),
        chartInventoryChart: t("reports.inventoryChart"),
        chartRevenueChart: t("reports.revenueChart"),
        chartExpenseChart: t("reports.expenseChart"),
        chartHighestStockProducts: t("reports.chartHighestStockProducts"),
        chartRevenueTrend: t("reports.chartRevenueTrend"),
        chartExpenseTrend: t("reports.chartExpenseTrend"),
        chartProfitTrend: t("reports.chartProfitTrend"),
        chartCertificatesByMonth: t("reports.certificatesByMonth"),
        chartCertificatesByCustomer: t("reports.certificatesByCustomer"),
        colDate: t("common.date"),
        colOrders: t("reports.tableOrdersHeader"),
        colQuantity: t("orders.quantity"),
        colSales: t("reports.tableSalesHeader"),
        colStatus: t("common.status"),
        colItems: t("reports.colItems"),
        colShare: t("reports.colShare"),
        colProduct: t("orders.product"),
        colStock: t("products.stock"),
        colUnit: t("reports.colUnit"),
        unitsWord: t("reports.unitsWord"),
        colCategory: t("certificates.category"),
        colCount: t("reports.colCount"),
        colAction: t("reports.colAction"),
        colInterpretation: t("reports.colInterpretation"),
        colMetadata: t("reports.colMetadata"),
        colValue: t("reports.colValue"),
        colArea: t("reports.colArea"),
        colIncluded: t("reports.colIncluded"),
        rowEmployeeCertificates: t("reports.employeeCertificates"),
        rowProductCertificates: t("reports.productCertificates"),
        rowNearExpiry: t("reports.rowNearExpiry"),
        rowExpired: t("reports.rowExpired"),
        statusActive: t("reports.statusLive"),
        statusAttention: t("reports.statusAttention"),
        statusCritical: t("reports.statusCritical"),
        actionNormalMonitoring: t("reports.actionNormalMonitoring"),
        actionReviewWithin30Days: t("reports.actionReviewWithin30Days"),
        actionRenewReview: t("reports.actionRenewReview"),
        stockHighest: t("reports.highestStock"),
        stockHealthy: t("reports.stockHealthy"),
        yes: t("reports.yes"),
        checklistExecutiveSummary: t("reports.checklistExecutiveSummary"),
        checklistSalesAnalytics: t("reports.checklistSalesAnalytics"),
        checklistDailyWeeklyMonthlySales: t("reports.checklistDailyWeeklyMonthlySales"),
        checklistCharts: t("reports.checklistCharts"),
        checklistSalesTrendTable: t("reports.checklistSalesTrendTable"),
        checklistInventoryAnalytics: t("reports.checklistInventoryAnalytics"),
        checklistAccountingSummary: t("reports.checklistAccountingSummary"),
        checklistCertificates: t("reports.checklistCertificates"),
        checklistCertificatesByMonthCustomer: t("reports.checklistCertificatesByMonthCustomer"),
        checklistReportOverview: t("reports.checklistReportOverview"),
        checklistCompanyBranding: t("reports.checklistCompanyBranding"),
        authorizedSignatory: t("reports.authorizedSignatory")
      },
      footerText: `${company.companyName || meta.companyName} • ${t("reports.businessPerformanceReportTitle")} • A4 Portrait • ${t("reports.confidential")}`,
      signatureName: company.certificateAuthorizedSignature || null,
      signatureDesignation: company.certificateAuthorizedDesignation || null,
      signatureLineLabel: t("reports.authorizedSignatory")
    });
  }

  // Async since it needs to await the company logo fetch -
  // exportPDF() already awaits this call.
  async function buildReportHtml(): Promise<string> {
    return buildReportHtmlNew();
  }

  async function exportPDF() {
    if (isExportingRef.current) return;
    isExportingRef.current = true;
    setExportingFormat("pdf");

    const api = (window as any).mooral;

    try {
      if (!api?.reports?.exportPdf) {
        throw new Error(t("reports.pdfServiceUnavailable"));
      }

      const html = await buildReportHtml();
      const result = await api.reports.exportPdf({
        html,
        fileName: buildExportFileName("pdf")
      });

      if (!result?.success && !result?.cancelled) {
        toast.error(result?.error ? `${t("reports.exportFailedPrefix")}${result.error}` : t("reports.exportFailedGeneric"));
      }
    } catch (err) {
      console.error("Failed to export report PDF:", err);
      toast.error(err instanceof Error ? err.message : t("reports.exportFailedGeneric"));
    } finally {
      isExportingRef.current = false;
      setExportingFormat(null);
    }
  }

  async function handlePrint() {
    if (isExportingRef.current) return;
    isExportingRef.current = true;
    setExportingFormat("print");

    try {
      const html = await buildReportHtml();
      await showPrintPreview({
        html,
        documentLabel: buildPrintDocumentLabel(t("reports.businessPerformanceReportTitle"))
      });
    } catch (err) {
      console.error("Failed to print report:", err);
      toast.error(err instanceof Error ? err.message : t("reports.printPreviewFailed"));
    } finally {
      isExportingRef.current = false;
      setExportingFormat(null);
    }
  }


  /* ------------------------------------------------------------------
     RENDER
     ------------------------------------------------------------------ */

  return (
    <div className="reports-page">

      <div className="reports-header no-print">
        <div>
          <h1>{t("reports.title")}</h1>
          <p>{t("reports.subtitle")}</p>
        </div>

        <div className="reports-export-toolbar" role="toolbar" aria-label={t("reports.exportToolbarLabel")}>
          <button className="export-btn" onClick={exportCSV} title={t("reports.exportCsvTitle")} disabled={exportingFormat !== null}>
            <Download size={16} />
            {exportingFormat === "csv" ? t("reports.exporting") : t("reports.exportCsv")}
          </button>
          <button className="export-btn" onClick={exportExcel} title={t("reports.exportExcelTitle")} disabled={exportingFormat !== null}>
            <FileSpreadsheet size={16} />
            {exportingFormat === "excel" ? t("reports.exporting") : t("reports.exportExcel")}
          </button>
          {hasPermission("reports.pdf_export") && (
            <button className="export-btn" onClick={exportPDF} title={t("reports.exportPdfTitle")} disabled={exportingFormat !== null}>
              <FileText size={16} />
              {exportingFormat === "pdf" ? t("reports.exporting") : t("reports.exportPdf")}
            </button>
          )}
          {hasPermission("reports.print") && (
            <button className="export-btn" onClick={handlePrint} title={t("reports.printTitle")} disabled={exportingFormat !== null}>
              <Printer size={16} />
              {exportingFormat === "print" ? t("reports.printing") : t("reports.print")}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="reports-error no-print" role="alert">
          <span>{error}</span>
          <button className="retry-btn" onClick={() => loadReports()}>
            <RefreshCw size={14} />
            {t("reports.retry")}
          </button>
        </div>
      )}

      <div className="reports-toolbar no-print">

        <div className="reports-date-filter">
          <input
            type="date"
            aria-label={t("reports.fromDateLabel")}
            value={fromDate}
            onChange={e => setFromDate(e.target.value)}
          />

          <input
            type="date"
            aria-label={t("reports.toDateLabel")}
            value={toDate}
            onChange={e => setToDate(e.target.value)}
          />

          <button onClick={applyManualFilter}>{t("reports.apply")}</button>
        </div>

        <select
          className="reports-section-filter"
          aria-label={t("reports.sectionFilterLabel")}
          value={sectionFilter}
          onChange={e => setSectionFilter(e.target.value)}
        >
          {SECTION_FILTERS.map(filter => (
            <option key={filter.key} value={filter.key}>{t(SECTION_FILTER_I18N_KEYS[filter.key])}</option>
          ))}
        </select>

        <div className="search-box">
          <Search size={18} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t("reports.searchPlaceholder")}
            aria-label={t("reports.searchLabel")}
          />
        </div>

      </div>

      <div className="reports-quick-filters no-print" role="group" aria-label={t("reports.quickFiltersLabel")}>
        {QUICK_FILTERS.map(filter => (
          <button
            key={filter.key}
            className={"quick-filter-btn" + (activeQuickFilter === filter.key ? " active" : "")}
            onClick={() => applyQuickFilter(filter.key)}
          >
            {t(QUICK_FILTER_I18N_KEYS[filter.key])}
          </button>
        ))}
      </div>

      {/* EXECUTIVE DASHBOARD */}
      {showSection("executive") && (
        <div className="reports-summary-grid" aria-busy={pendingFirstLoad}>
          {filteredExecutiveCards.map(card => (
            <div className="reports-card" key={card.title}>
              <span>{card.title}</span>
              <strong>{pendingFirstLoad ? "—" : card.value}</strong>
            </div>
          ))}

          {filteredExecutiveCards.length === 0 && (
            <div className="reports-empty">{t("reports.noMatchingSummaryCards")}</div>
          )}
        </div>
      )}

      {/* SALES ANALYTICS */}
      {showSection("sales") && (
      <div className="reports-section">
        <h2>{t("reports.salesAnalytics")}</h2>

        <div className="reports-sales-grid">
          {filteredSalesAnalyticsCards.map(card => (
            <div className="reports-sales-card" key={card.title}>
              <span>{card.title}</span>
              <strong>{pendingFirstLoad ? "—" : card.value}</strong>
            </div>
          ))}

          {filteredSalesAnalyticsCards.length === 0 && (
            <div className="reports-empty">{t("reports.noMatchingAnalyticsCards")}</div>
          )}
        </div>

        <div className="charts-grid">
          <div className="chart-card">
            <h3>{t("reports.dailySales")}</h3>
            <MiniLineChart data={dailySales} />
          </div>
          <div className="chart-card">
            <h3>{t("reports.weeklySales")}</h3>
            <MiniLineChart data={weeklySales} color="var(--primary-dark, #1d4ed8)" />
          </div>
          <div className="chart-card">
            <h3>{t("reports.monthlySales")}</h3>
            <MiniLineChart data={monthlySales} />
          </div>
        </div>
      </div>
      )}

      {/* CHARTS & TRENDS */}
      {(showSection("sales") || showSection("accounting") || showSection("inventory")) && (
      <div className="reports-section">
        <h2>{t("reports.chartsAndTrends")}</h2>

        <div className="charts-grid">
          <div className="chart-card">
            <h3>{t("reports.salesLineChart")}</h3>
            <MiniLineChart data={salesTrendSorted.slice(0, 14).map(row => ({ label: row.date, value: row.sales })).reverse()} />
          </div>
          <div className="chart-card">
            <h3>{t("reports.revenueChart")}</h3>
            <MiniLineChart data={revenueChartData} />
          </div>
          <div className="chart-card">
            <h3>{t("reports.expenseChart")}</h3>
            <MiniLineChart data={expenseChartData} color="#dc2626" />
          </div>
          <div className="chart-card">
            <h3>{t("reports.inventoryChart")}</h3>
            <MiniLineChart data={topProductsByStock} color="#16a34a" />
          </div>
        </div>
      </div>
      )}

      {/* SALES TREND TABLE */}
      {showSection("sales") && (
      <div className="reports-section">
        <h2>{t("reports.salesTrend")}</h2>

        <div className="table-scroll">
          <table className="reports-table reports-table-head">
            <thead>
              <tr>
                <th>{t("common.date")}</th>
                <th>{t("reports.tableOrdersHeader")}</th>
                <th>{t("orders.quantity")}</th>
                <th>{t("reports.tableSalesHeader")}</th>
              </tr>
            </thead>
          </table>

          <div className="reports-table-body">
            <table className="reports-table">
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={4} className="reports-empty">{t("reports.loadingSalesTrend")}</td>
                </tr>
              )}

              {!loading && error && (
                <tr>
                  <td colSpan={4} className="reports-empty">{t("reports.unableToLoad")}</td>
                </tr>
              )}

              {!loading && !error && filteredSalesTrend.map(row => (
                <tr key={row.date}>
                  <td>{formatDateLabel(row.date)}</td>
                  <td>{row.orders}</td>
                  <td>{row.quantity}</td>
                  <td>{formatCurrency(row.sales)}</td>
                </tr>
              ))}

              {!loading && !error && filteredSalesTrend.length === 0 && (
                <tr>
                  <td colSpan={4} className="reports-empty">{t("reports.noSalesTrendData")}</td>
                </tr>
              )}
            </tbody>
            </table>
          </div>
        </div>
      </div>
      )}

      {/* INVENTORY ANALYTICS */}
      {showSection("inventory") && (
      <div className="reports-section">
        <h2>{t("reports.inventoryAnalytics")}</h2>

        <div className="reports-sales-grid">
          {filteredInventoryCards.map(card => (
            <div className="reports-sales-card" key={card.title}>
              <span>{card.title}</span>
              <strong>{pendingFirstLoad ? "—" : card.value}</strong>
            </div>
          ))}

          {filteredInventoryCards.length === 0 && (
            <div className="reports-empty">{t("reports.noMatchingInventoryCards")}</div>
          )}
        </div>
      </div>
      )}

      {/* ACCOUNTING SUMMARY */}
      {showSection("accounting") && (
      <div className="reports-section">
        <h2>{t("reports.accountingSummary")}</h2>

        <div className="reports-sales-grid">
          {filteredAccountingCards.map(card => (
            <div className="reports-sales-card" key={card.title}>
              <span>{card.title}</span>
              <strong>{pendingFirstLoad ? "—" : card.value}</strong>
            </div>
          ))}

          {filteredAccountingCards.length === 0 && (
            <div className="reports-empty">{t("reports.noMatchingAccountingCards")}</div>
          )}
        </div>
      </div>
      )}

      {/* CERTIFICATES */}
      {showSection("certificates") && (
      <div className="reports-section">
        <h2>{t("reports.certificates")}</h2>

        <div className="reports-sales-grid">
          <div className="reports-sales-card">
            <span>{t("reports.employeeCertificates")}</span>
            <strong>{certificateSummary?.employeeCount ?? 0}</strong>
          </div>
          <div className="reports-sales-card">
            <span>{t("reports.productCertificates")}</span>
            <strong>{certificateSummary?.productCount ?? 0}</strong>
          </div>
          <div className="reports-sales-card">
            <span>{t("reports.certificatesNearExpiry")}</span>
            <strong>{certificateSummary?.nearExpiryCount ?? 0}</strong>
          </div>
          <div className="reports-sales-card">
            <span>{t("reports.expiredCertificates")}</span>
            <strong>{(certificateSummary?.expiredCount ?? 0) + (certificateSummary?.overdueExpiredCount ?? 0)}</strong>
          </div>
        </div>

        <div className="charts-grid">
          <div className="chart-card">
            <h3>{t("reports.certificatesByMonth")}</h3>
            <MiniLineChart data={certificatesByMonth} color="#7c3aed" />
          </div>
          <div className="chart-card">
            <h3>{t("reports.certificatesByCustomer")}</h3>
            <MiniLineChart data={certificatesByCustomer} color="#7c3aed" />
          </div>
        </div>
      </div>
      )}

      {/* REPORT OVERVIEW */}
      <div className="reports-section">
        <h2>{t("reports.reportOverview")}</h2>
        <p>{t("reports.reportOverviewDesc")}</p>

        <div className="reports-overview-grid">
          {reportOverviewCards.map(card => (
            <div className="reports-overview-card" key={card.title}>
              <span>{card.title}</span>
              <strong>{pendingFirstLoad ? "—" : card.value}</strong>
            </div>
          ))}
        </div>
      </div>

      {/* ==================================================================
          PRINTABLE / PDF REPORT LAYOUT
          Hidden on screen, shown only when printing / exporting to PDF via
          the browser's native print-to-PDF pipeline (see reports.css
          @media print rules).
         ================================================================== */}
      <div className="printable-report">

        <div className="print-header">
          <div className="print-logo-block">
            {printLogoDataUrl ? (
              <img src={printLogoDataUrl} alt={printCompanyName} className="print-logo-image" />
            ) : (
              <div className="print-logo-placeholder">{t("reports.logoPlaceholder")}</div>
            )}
            <div>
              <div className="print-company-name">{printCompanyName}</div>
              <div className="print-company-sub">{t("reports.printSubtitle")}</div>
            </div>
          </div>

          <div className="print-meta">
            <div><strong>{t("reports.printReportLabel")}</strong> {t("reports.businessPerformanceReportTitle")}</div>
            <div><strong>{t("reports.printDateRangeLabel")}</strong> {activeFiltersLabel}</div>
            <div><strong>{t("reports.printGeneratedLabel")}</strong> {new Date().toLocaleString()}</div>
          </div>
        </div>

        <h1 className="print-title">{t("reports.businessPerformanceReportTitle")}</h1>

        <section className="print-section">
          <h2>{t("reports.sectionExecutive")}</h2>
          <table className="print-table">
            <tbody>
              {executiveCards.map(card => (
                <tr key={card.title}>
                  <td>{card.title}</td>
                  <td className="print-align-right">{pendingFirstLoad ? "—" : card.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="print-section">
          <h2>{t("reports.salesAnalytics")}</h2>
          <table className="print-table">
            <tbody>
              {salesAnalyticsCards.map(card => (
                <tr key={card.title}>
                  <td>{card.title}</td>
                  <td className="print-align-right">{pendingFirstLoad ? "—" : card.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="print-section">
          <h2>{t("reports.inventorySummary")}</h2>
          <table className="print-table">
            <tbody>
              {inventoryCards.map(card => (
                <tr key={card.title}>
                  <td>{card.title}</td>
                  <td className="print-align-right">{pendingFirstLoad ? "—" : card.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="print-section">
          <h2>{t("reports.accountingSummary")}</h2>
          <table className="print-table">
            <tbody>
              {accountingCards.map(card => (
                <tr key={card.title}>
                  <td>{card.title}</td>
                  <td className="print-align-right">{pendingFirstLoad ? "—" : card.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="print-section print-avoid-break">
          <h2>{t("reports.salesTrend")}</h2>
          <table className="print-table print-data-table">
            <thead>
              <tr>
                <th>{t("common.date")}</th>
                <th>{t("reports.tableOrdersHeader")}</th>
                <th>{t("orders.quantity")}</th>
                <th>{t("reports.tableSalesHeader")}</th>
              </tr>
            </thead>
            <tbody>
              {salesTrendSorted.map(row => (
                <tr key={row.date}>
                  <td>{formatDateLabel(row.date)}</td>
                  <td>{row.orders}</td>
                  <td>{row.quantity}</td>
                  <td className="print-align-right">{formatCurrency(row.sales)}</td>
                </tr>
              ))}
              {salesTrendSorted.length === 0 && (
                <tr>
                  <td colSpan={4}>{t("reports.noSalesTrendData")}</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        <div className="print-footer">
          {t("reports.printFooter")}
        </div>
      </div>

    </div>
  );
}
