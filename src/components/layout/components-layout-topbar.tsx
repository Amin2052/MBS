import {
  Search,
  Bell,
  UserCircle
} from "lucide-react";

import {
  useEffect,
  useMemo,
  useState
} from "react";

import {
  useNavigate
} from "react-router-dom";

import { useLanguage } from "@/hooks/use-language";

import "./topbar.css";


type ResultType = "product" | "customer" | "order" | "invoice" | "inventory";

type SearchResult = {
  type: ResultType;
  key: string;
  title: string;
  subtitle: string;
  onSelect: () => void;
};



export default function Topbar(): JSX.Element {

  const navigate = useNavigate();

  const { t } = useLanguage();

  const [search, setSearch] = useState("");

  const [products, setProducts] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [inventory, setInventory] = useState<any[]>([]);


  useEffect(() => {

    async function loadAll() {

      try {

        const [
          productsData,
          customersData,
          ordersData,
          invoicesData,
          inventoryData
        ] = await Promise.all([
          window.mooral.products.getAll(),
          window.mooral.customers.getAll(),
          window.mooral.orders.getAll(),
          window.mooral.invoices.getAll(),
          window.mooral.inventory.getAll()
        ]);

        setProducts(Array.isArray(productsData) ? productsData : []);
        setCustomers(Array.isArray(customersData) ? customersData : []);
        setOrders(Array.isArray(ordersData) ? ordersData : []);
        setInvoices(Array.isArray(invoicesData) ? invoicesData : []);
        setInventory(Array.isArray(inventoryData) ? inventoryData : []);

      } catch (error) {

        console.error("Global search data load error:", error);

      }

    }

    loadAll();

  }, []);


  function openProduct(product: any) {
    if (!product.id) return;
    navigate("/product-details?id=" + product.id);
    setSearch("");
  }

  function openCustomer(customer: any) {
    if (!customer.id) return;
    navigate("/customers?id=" + customer.id);
    setSearch("");
  }

  function openOrder(order: any) {
    if (!order.id) return;
    navigate("/orders?id=" + order.id);
    setSearch("");
  }

  function openInvoice(invoice: any) {
    if (!invoice.id) return;
    navigate("/invoices?id=" + invoice.id);
    setSearch("");
  }

  function openInventory(item: any) {
    navigate("/inventory?product_id=" + encodeURIComponent(item.product_id ?? ""));
    setSearch("");
  }


  const results = useMemo(() => {

    const keyword = search.trim().toLowerCase();

    if (!keyword) {
      return [] as SearchResult[];
    }

    const matched: SearchResult[] = [];

    products
      .filter((product) => {
        const searchable = `
          ${product.id ?? ""}
          ${product.product_id ?? ""}
          ${product.name ?? ""}
          ${product.category ?? ""}
          ${product.sku ?? ""}
          ${product.price ?? ""}
          ${product.stock ?? ""}
        `.toLowerCase();
        return searchable.includes(keyword);
      })
      .slice(0, 5)
      .forEach((product) => {
        matched.push({
          type: "product",
          key: "product-" + product.id,
          title: product.name,
          subtitle: `ID: ${product.product_id ?? "-"} | SKU: ${product.sku ?? "-"}`,
          onSelect: () => openProduct(product)
        });
      });

    customers
      .filter((customer) => {
        const searchable = `
          ${customer.id ?? ""}
          ${customer.customer_id ?? ""}
          ${customer.name ?? ""}
          ${customer.phone ?? ""}
          ${customer.email ?? ""}
          ${customer.address ?? ""}
        `.toLowerCase();
        return searchable.includes(keyword);
      })
      .slice(0, 5)
      .forEach((customer) => {
        matched.push({
          type: "customer",
          key: "customer-" + customer.id,
          title: customer.name,
          subtitle: `ID: ${customer.customer_id ?? "-"} | Phone: ${customer.phone ?? "-"}`,
          onSelect: () => openCustomer(customer)
        });
      });

    orders
      .filter((order) => {
        const searchable = `
          ${order.id ?? ""}
          ${order.order_id ?? ""}
          ${order.customer_id ?? ""}
          ${order.customer_name ?? ""}
          ${order.product_id ?? ""}
          ${order.product_name ?? ""}
          ${order.status ?? ""}
          ${order.total ?? ""}
        `.toLowerCase();
        return searchable.includes(keyword);
      })
      .slice(0, 5)
      .forEach((order) => {
        matched.push({
          type: "order",
          key: "order-" + order.id,
          title: `Order ${order.order_id ?? order.id}`,
          subtitle: `${order.customer_name ?? "-"} | ${order.product_name ?? "-"} | ${order.status ?? "-"}`,
          onSelect: () => openOrder(order)
        });
      });

    invoices
      .filter((invoice) => {
        const searchable = `
          ${invoice.id ?? ""}
          ${invoice.invoice_id ?? ""}
          ${invoice.customer_id ?? ""}
          ${invoice.customer_name ?? ""}
          ${invoice.status ?? ""}
          ${invoice.payment_method ?? ""}
          ${invoice.total ?? ""}
        `.toLowerCase();
        return searchable.includes(keyword);
      })
      .slice(0, 5)
      .forEach((invoice) => {
        matched.push({
          type: "invoice",
          key: "invoice-" + invoice.id,
          title: `Invoice ${invoice.invoice_id ?? invoice.id}`,
          subtitle: `${invoice.customer_name ?? "-"} | ${invoice.status ?? "-"}`,
          onSelect: () => openInvoice(invoice)
        });
      });

    inventory
      .filter((item) => {
        const searchable = `
          ${item.id ?? ""}
          ${item.product_id ?? ""}
          ${item.type ?? ""}
          ${item.quantity ?? ""}
          ${item.note ?? ""}
        `.toLowerCase();
        return searchable.includes(keyword);
      })
      .slice(0, 5)
      .forEach((item) => {
        matched.push({
          type: "inventory",
          key: "inventory-" + item.id,
          title: `${item.type === "IN" ? "Stock In" : "Stock Out"} - ${item.product_id ?? "-"}`,
          subtitle: `Qty: ${item.quantity ?? "-"}${item.note ? " | " + item.note : ""}`,
          onSelect: () => openInventory(item)
        });
      });

    return matched.slice(0, 20);

  }, [search, products, customers, orders, invoices, inventory]);


  const typeLabels: Record<ResultType, string> = {
    product: "Product",
    customer: "Customer",
    order: "Order",
    invoice: "Invoice",
    inventory: "Inventory"
  };


  return (

    <header className="topbar">

      <div className="topbar-search">

        <Search size={18} />

        <input
          type="text"
          placeholder={t("topbar.searchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        {
          search &&

          <div className="search-results">

            {
              results.length > 0 ?

              results.map((result) => (

                <div
                  key={result.key}
                  className="search-item"
                  onClick={() => result.onSelect()}
                >

                  <div className="search-item-header">
                    <strong>{result.title}</strong>
                    <span className="search-item-badge">
                      {typeLabels[result.type]}
                    </span>
                  </div>

                  <span>{result.subtitle}</span>

                </div>

              ))

              :

              <div className="search-empty">
                No matching results found
              </div>

            }

          </div>

        }

      </div>

      <div className="topbar-actions">

        <button className="topbar-btn">
          <Bell size={20} />
        </button>

        <button className="profile-btn">

          <UserCircle size={28} />

          <div>
            <strong>{t("topbar.admin")}</strong>
            <span>{t("topbar.administrator")}</span>
          </div>

        </button>

      </div>

    </header>

  );

}
