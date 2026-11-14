import {
  Search,
  Plus,
  X,
  Pencil,
  Trash2,
  CheckCircle
} from "lucide-react";

import {
  useEffect,
  useMemo,
  useState
} from "react";

import {
  useSearchParams
} from "react-router-dom";

import "./orders.css";

import {
  formatNumber
} from "../utils/format-number";

import { useAuth } from "@/hooks/use-auth";
import { useCurrency } from "@/hooks/use-currency";
import { useLanguage } from "@/hooks/use-language";
import { getCompanySettings } from "@/services/company-settings-service";

// Customer, Product and Order are declared globally in
// src/types/electron.d.ts (previously this file redeclared local,
// narrower copies of all three).

type OrderLine = {
  product_id: string;
  product_name: string;
  quantity: string;
  unit_price: string;
};

type OrderForm = {
  customer_id: string;
  customer_name: string;
  status: string;
  lines: OrderLine[];
};

const emptyLine = (): OrderLine => ({
  product_id: "",
  product_name: "",
  quantity: "1",
  unit_price: "0"
});

function formFromOrder(order: Order): OrderForm {
  // An order can carry multiple products (order.items). Map every one of
  // them into a line so editing a multi-product order shows -- and can
  // save back -- all of its products, not just the first. Falls back to
  // the order's own single-line fields only for legacy data that has no
  // `items` array.
  const lines: OrderLine[] = order.items && order.items.length
    ? order.items.map(item => ({
        product_id: item.product_id || "",
        product_name: item.product_name,
        quantity: String(item.quantity),
        unit_price: String(item.price)
      }))
    : [{
        product_id: order.product_id || "",
        product_name: order.product_name,
        quantity: String(order.quantity),
        unit_price: String(order.price)
      }];

  return {
    customer_id: order.customer_id || "",
    customer_name: order.customer_name,
    status: order.status,
    lines
  };
}

/** Maps an order status to its badge modifier class. */
function statusClass(status: string): string {
  switch (status.toLowerCase()) {
    case "completed":
      return "status-badge status-completed";
    case "cancelled":
      return "status-badge status-cancelled";
    case "pending approval":
      return "status-badge status-pending-approval";
    default:
      return "status-badge status-pending";
  }
}

type OrderModalProps = {
  customers: Customer[];
  products: Product[];
  editingOrder: Order | null;
  onClose: () => void;
  onSave: (
    editId: number | null,
    order: {
      order_id: string;
      customer_id: string;
      customer_name: string;
      status: string;
      items: Array<{
        product_id: string;
        product_name: string;
        quantity: number;
        price: number;
        total: number;
      }>;
    }
  ) => Promise<void>;
};

/**
 * Add/Edit Order modal.
 *
 * This form's state used to live directly on OrdersPage, which also
 * renders the full (unpaginated) orders table and the Customer/Product
 * option lists. Because all of that lived in one component, every single
 * keystroke in Quantity re-rendered the *entire* OrdersPage -- including
 * re-reconciling every row of the orders table and every <option> in both
 * dropdowns -- even though none of that output actually changes while
 * typing a quantity. As the orders/customers/products tables grow with
 * real use, that full-page re-render on every keystroke is what caused
 * typing in Quantity to intermittently stall/freeze.
 *
 * Moving the form's state into its own component means a keystroke here
 * only re-renders this modal, not the parent page or its table, which is
 * the actual fix (not a debounce/workaround) -- the table and dropdown
 * lists no longer re-render at all while the user types.
 */
function OrderModal({
  customers,
  products,
  editingOrder,
  onClose,
  onSave
}: OrderModalProps): JSX.Element {

  const { format: formatCurrency } = useCurrency();
  const { t } = useLanguage();

  const [form, setForm] = useState<OrderForm>(
    editingOrder ? formFromOrder(editingOrder) : {
      customer_id: "",
      customer_name: "",
      status: "Pending",
      lines: [emptyLine()]
    }
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  const orderTotal = useMemo(() => form.lines.reduce((sum, line) => {
    return sum + Number(line.quantity || 0) * Number(line.unit_price || 0);
  }, 0), [form.lines]);

  function updateForm(patch: Partial<OrderForm>) {
    setForm(prev => ({ ...prev, ...patch }));
  }

  function handleCustomerChange(customerId: string) {
    const customer = customers.find(c => c.customer_id === customerId);
    updateForm({
      customer_id: customer?.customer_id || "",
      customer_name: customer?.name || ""
    });
  }

  function handleProductChange(index: number, productId: string) {
    const product = products.find(p => p.product_id === productId);
    setForm(prev => ({
      ...prev,
      lines: prev.lines.map((line, i) => i === index
        ? { ...line, product_id: product?.product_id || "", product_name: product?.name || "", unit_price: String(product?.price || 0) }
        : line)
    }));
  }

  function updateLine(index: number, patch: Partial<OrderLine>) {
    setForm(prev => ({
      ...prev,
      lines: prev.lines.map((line, i) => i === index ? { ...line, ...patch } : line)
    }));
  }

  function addLine() {
    // Editing an order must be able to add products to it too -- an
    // order's product list isn't fixed at creation time, so this is no
    // longer restricted to "Add Order" only.
    setForm(prev => ({ ...prev, lines: [...prev.lines, emptyLine()] }));
  }

  function removeLine(index: number) {
    if (form.lines.length === 1) return;
    setForm(prev => ({ ...prev, lines: prev.lines.filter((_, i) => i !== index) }));
  }

  async function saveOrder() {
    if (!form.customer_id) {
      alert("Select Customer.");
      return;
    }
    if (isSubmitting) return;

    const items = form.lines.map(line => ({
      product_id: line.product_id,
      product_name: line.product_name,
      quantity: Number(line.quantity),
      price: Number(line.unit_price),
      total: Number(line.quantity) * Number(line.unit_price)
    }));

    if (items.some(item => !item.product_id || !item.product_name)) {
      alert("Select a product for every line.");
      return;
    }
    if (new Set(items.map(item => item.product_id)).size !== items.length) {
      alert("A product can only be added once to the same order.");
      return;
    }
    if (items.some(item => !Number.isFinite(item.quantity) || item.quantity <= 0)) {
      alert("Quantity must be a positive number.");
      return;
    }

    setIsSubmitting(true);

    try {
      await onSave(editingOrder ? editingOrder.id ?? null : null, {
        order_id: editingOrder ? editingOrder.order_id || "" : "",
        customer_id: form.customer_id,
        customer_name: form.customer_name,
        status: form.status,
        items
      });
    } catch (error) {
      console.error("Failed to save order:", error);
      window.alert(error instanceof Error ? error.message : t("orders.saveFailed"));
      return;
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="modal-overlay">
      <div className="order-modal" onClick={(e) => e.stopPropagation()}>

        <div className="modal-header">
          <h2>{editingOrder ? t("orders.editOrder") : t("orders.addOrder")}</h2>
          <button onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="modal-body">

          <div className="form-group">
            <label>{t("orders.customer")}</label>
            <select
              value={form.customer_id}
              onChange={(e) => handleCustomerChange(e.target.value)}
            >
              <option value="">{t("orders.selectCustomer")}</option>
              {customers.map(customer => (
                <option key={customer.id ?? customer.customer_id} value={customer.customer_id}>
                  {customer.name}
                </option>
              ))}
            </select>
          </div>

          {form.lines.map((line, index) => (
          <div key={index} className="order-line">
            <div className="form-group">
              <label>{t("orders.product")} {index + 1}</label>
              <select
                value={line.product_id}
                onChange={(e) => handleProductChange(index, e.target.value)}
              >
                <option value="">{t("orders.selectProduct")}</option>
                {products
                  .filter(product => !form.lines.some((otherLine, otherIndex) => otherIndex !== index && otherLine.product_id === product.product_id))
                  .map(product => (
                    <option key={product.id ?? product.product_id} value={product.product_id}>
                      {product.name}
                    </option>
                  ))}
              </select>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>{t("orders.quantity")}</label>
                <input type="number" min={1} value={line.quantity} onChange={(e) => updateLine(index, { quantity: e.target.value })} />
              </div>
              <div className="form-group">
                <label>{t("orders.unitPrice")}</label>
                <input type="number" value={line.unit_price} readOnly />
              </div>
            </div>
            {form.lines.length > 1 && (
              <button type="button" className="remove-order-line" onClick={() => removeLine(index)}>{t("orders.removeProduct")}</button>
            )}
          </div>
        ))}

        <button type="button" className="add-order-line" onClick={addLine}>{t("orders.addAnotherProduct")}</button>

          <div className="total-box">
            <span className="total-label">{t("orders.totalAmount")}</span>
            <span className="total-value">{formatCurrency(orderTotal)}</span>
          </div>

          <div className="form-group">
            <label>{t("orders.status")}</label>
            <select
              value={form.status}
              onChange={(e) => updateForm({ status: e.target.value })}
            >
              <option value="Pending">{t("orders.pending")}</option>
              <option value="Completed">{t("orders.completed")}</option>
              <option value="Cancelled">{t("orders.cancelled")}</option>
            </select>
          </div>

          <button
            className="save-order"
            onClick={saveOrder}
            disabled={isSubmitting}
          >
            {isSubmitting ? "Saving..." : "Save Order"}
          </button>

        </div>
      </div>
    </div>
  );
}

export default function OrdersPage(): JSX.Element {

  const { hasPermission } = useAuth();
  const { format: formatCurrency } = useCurrency();
  const { t } = useLanguage();
  const [searchParams, setSearchParams] = useSearchParams();
  const [orders, setOrders] = useState<Order[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  // Sales & Purchase Settings > "Require Approval Before Order
  // Confirmation" (see settings/sales-purchase.tsx). When enabled, new
  // orders are created as "Pending Approval" instead of "Pending" and
  // must be explicitly approved (orders.approve permission) before they
  // can proceed through the normal order lifecycle.
  const [requireApproval, setRequireApproval] = useState(false);

  async function loadOrders() {
    const data = await window.mooral.orders.getAll();
    setOrders(data);
  }

  async function loadCustomers() {
    const data = await window.mooral.customers.getAll();
    setCustomers(data);
  }

  async function loadProducts() {
    const data = await window.mooral.products.getAll();
    setProducts(data);
  }

  useEffect(() => {
    (async () => {
      setLoading(true);

      try {
        await Promise.all([loadOrders(), loadCustomers(), loadProducts()]);
      } catch (error) {
        console.error("Failed to load orders data:", error);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const settings = await getCompanySettings();
        setRequireApproval(settings.salesRequireApproval);
      } catch (error) {
        console.error("Failed to load sales approval setting:", error);
      }
    })();
  }, []);

  useEffect(() => {
    if (searchParams.get("action") === "add") {
      openAdd();

      const next = new URLSearchParams(searchParams);
      next.delete("action");
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const filteredOrders = useMemo(() => {
    const keyword = search.trim().toLowerCase();

    if (!keyword) {
      return orders;
    }

    return orders.filter(order =>
      (order.order_id || "").toLowerCase().includes(keyword) ||
      (order.customer_name || "").toLowerCase().includes(keyword) ||
      (order.status || "").toLowerCase().includes(keyword) ||
      (order.items || []).some(item => (item.product_name || "").toLowerCase().includes(keyword))
    );
  }, [orders, search]);

  const editingOrder = useMemo(
    () => (editId ? orders.find(o => o.id === editId) ?? null : null),
    [orders, editId]
  );

  function openAdd() {
    setEditId(null);
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
  }

  async function handleSaveOrder(
    id: number | null,
    order: {
      order_id: string;
      customer_id: string;
      customer_name: string;
      status: string;
      items: Array<{ product_id: string; product_name: string; quantity: number; price: number; total: number; }>;
    }
  ) {
    // New orders are forced into "Pending Approval" instead of whatever
    // status the form defaulted to, when Sales & Purchase Settings >
    // "Require Approval Before Order Confirmation" is enabled -- this is
    // what actually makes that setting do something (previously it was
    // stored but never read anywhere).
    const effectiveOrder =
      !id && requireApproval && order.status !== "Cancelled"
        ? { ...order, status: "Pending Approval" }
        : order;

    if (id) {
      // Send the whole product list back, not just the first line --
      // an order can carry multiple products and every one of them
      // needs to be saved, not only the one a single-product model
      // would have kept.
      await window.mooral.orders.update({ id, order: effectiveOrder as Order });
    } else {
      await window.mooral.orders.create(effectiveOrder as Order);
    }

    await loadOrders();
    await loadProducts();
    setShowModal(false);
  }

  async function approveOrder(order: Order) {
    if (!order.id) return;

    await window.mooral.orders.update({
      id: order.id,
      order: { ...order, status: "Pending" } as Order
    });

    await loadOrders();
  }

  function editOrder(order: Order) {
    setEditId(order.id || null);
    setShowModal(true);
  }

  async function deleteOrder(id: number) {
    if (!window.confirm(t("orders.confirmDelete"))) return;

    try {
      await window.mooral.orders.delete(id);
      await loadOrders();
      await loadProducts();
    } catch (error) {
      console.error("Failed to delete order:", error);
      window.alert(
        error instanceof Error
          ? error.message
          : t("orders.deleteFailed")
      );
    }
  }

  return (
    <div className="orders-page">

      <div className="orders-header">
        <div>
          <h1>{t("orders.title")}</h1>
          <p>{t("orders.subtitle")}</p>
        </div>

        {hasPermission("orders.create") && (
        <button className="add-order" onClick={openAdd}>
          <Plus size={18} />
          {t("orders.addOrder")}
        </button>
        )}
      </div>

      <div className="order-toolbar">
        <div className="search-box">
          <Search size={18} />
          <input
  type="text"
  placeholder={t("orders.searchPlaceholder")}
  value={search}
  onChange={(e) => setSearch(e.target.value)}
/>
        </div>
      </div>

      <div className="order-table">
        {/*
          The Orders row is now one order per row (Order No., Customer,
          Products Count, Grand Total, Status, Actions) instead of one
          row per line item, but orders.css's .table-head/.table-row grid
          still defines the previous 8-column template. Rendering only 6
          <span> cells against an 8-track grid was the regression: two
          tracks were left empty, so columns no longer filled the table
          width the way they used to and long labels like "Grand Total"
          could wrap. This inline override is scoped to just these two
          elements and reuses the same pixel values as the previous
          8-column template for every column whose role carries over
          (Order No./ID: 110px, Status: 120px, Actions: 110px), so the
          restored widths, spacing, padding and alignment -- all still
          coming from the unchanged .table-head/.table-row/.table-head
          span/.table-row span rules in orders.css -- match the previous
          design instead of introducing a new one.
        */}
        <div
          className="table-head"
          style={{ gridTemplateColumns: "110px 1.5fr 140px 150px 120px 110px" }}
        >
          <span style={{ whiteSpace: "nowrap" }}>{t("orders.orderNo")}</span>
          <span style={{ whiteSpace: "nowrap" }}>{t("orders.customer")}</span>
          <span style={{ whiteSpace: "nowrap" }}>{t("orders.productsCount")}</span>
          <span style={{ whiteSpace: "nowrap" }}>{t("orders.grandTotal")}</span>
          <span style={{ whiteSpace: "nowrap" }}>{t("orders.status")}</span>
          <span style={{ whiteSpace: "nowrap" }}>{t("orders.actions")}</span>
        </div>

        {loading && (
          <div className="empty-orders">{t("orders.loadingOrders")}</div>
        )}

        <div className="order-table-body">
        {!loading && filteredOrders.map(order => (
          <div
            className="table-row"
            key={order.id ?? order.order_id}
            style={{ gridTemplateColumns: "110px 1.5fr 140px 150px 120px 110px" }}
          >
            <span>{order.order_id}</span>
            <span>{order.customer_name}</span>
            <span>{formatNumber((order.items || []).length)}</span>
            <span style={{ whiteSpace: "nowrap" }}>{formatCurrency(order.total)}</span>
            <span>
              <span className={statusClass(order.status)}>
                {order.status}
              </span>
            </span>
            <span className="order-actions">
              {order.status === "Pending Approval" && hasPermission("orders.approve") && (
              <button
                className="action-approve"
                title="Approve order"
                onClick={() => approveOrder(order)}
              >
                <CheckCircle size={16} />
              </button>
              )}
              {hasPermission("orders.edit") && (
              <button
                className="action-edit"
                title="Edit order"
                onClick={() => editOrder(order)}
              >
                <Pencil size={16} />
              </button>
              )}
              {hasPermission("orders.delete") && (
              <button
                className="action-delete"
                title="Delete order"
                onClick={() => deleteOrder(order.id!)}
              >
                <Trash2 size={16} />
              </button>
              )}
            </span>
          </div>
        ))}

        {!loading && filteredOrders.length === 0 && (
          <div className="empty-orders">{t("orders.noOrdersFound")}</div>
        )}
        </div>
      </div>

      {showModal && (
        <OrderModal
          customers={customers}
          products={products}
          editingOrder={editingOrder}
          onClose={closeModal}
          onSave={handleSaveOrder}
        />
      )}

    </div>
  );
}
