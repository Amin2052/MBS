import {
  Search,
  UserCircle,
  LogOut
} from "lucide-react";

import {
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import {
  useNavigate
} from "react-router-dom";

import { useLanguage } from "@/hooks/use-language";
import { useAuth } from "@/hooks/use-auth";
import { getMyProfilePhoto, onProfilePhotoChanged } from "@/services/auth-service";


import "./topbar.css";

// PHASE 10 UI AUDIT FIX: these used to be hardcoded English-only maps,
// unlike every other user-facing string in this file (which already goes
// through t()). "settingsUserManagement.owner/administrator/employee"
// already exist with real Bengali/Arabic translations (used by the user
// management settings page, see src/pages/settings/user-management.tsx)
// -- reusing those same keys here instead of introducing new
// topbar-specific ones, so the profile chip and global search results
// correctly localize instead of silently staying in English under ar/bn.
//
// BUGFIX: this previously pointed at "userManagement.owner" etc., but
// "userManagement" in en.ts/bn.ts/ar.ts is a single flat string (the
// settings-page nav label), not an object with .owner/.administrator/
// .employee children -- so resolvePath() in translator.ts could never
// walk into it and t() fell back to returning the raw, unresolved key
// itself. That's what rendered literally in the header as
// "userManagement.owner - <name>" instead of "Owner - <name>". The
// correct existing namespace (confirmed present with real translations
// in all 3 locales) is "settingsUserManagement".
const USER_TYPE_KEYS: Record<string, string> = {
  owner: "settingsUserManagement.owner",
  administrator: "settingsUserManagement.administrator",
  employee: "settingsUserManagement.employee"
};

type ResultType = "product" | "customer" | "order" | "inventory" | "certificate";

const RESULT_TYPE_KEYS: Record<ResultType, string> = {
  product: "topbar.resultTypeProduct",
  customer: "topbar.resultTypeCustomer",
  order: "topbar.resultTypeOrder",
  inventory: "topbar.resultTypeInventory",
  certificate: "topbar.resultTypeCertificate"
};

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
  const { user, logout, hasPermission } = useAuth();

  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);

  // Topbar avatar: fetches its own copy on mount (covers page refresh /
  // re-login / a fresh session picking this up on load) and also listens
  // for the profile page's change event so it updates immediately within
  // the same session without needing a reload.
  const [avatarPhoto, setAvatarPhoto] = useState<string | null>(null);

  useEffect(() => {

    let cancelled = false;

    getMyProfilePhoto().then(dataUrl => {
      if (!cancelled) {
        setAvatarPhoto(dataUrl);
      }
    });

    const unsubscribe = onProfilePhotoChanged(photo => {
      setAvatarPhoto(photo);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };

  }, [user?.id]);

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const [products, setProducts] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [inventory, setInventory] = useState<any[]>([]);
  const [certificates, setCertificates] = useState<any[]>([]);
  


  // Global search only ever loads a dataset the current user is
  // actually allowed to view -- an Employee without, say,
  // `employees.view` (there's no separate "search" permission; this
  // reuses the same module.view keys the rest of the app already
  // gates routes/buttons with) should never have Customer or
  // Certificate records reachable through the search box just
  // because the topbar happens to render on every page. Inventory
  // has no entry of its own in the permission catalog -- it's gated
  // under "products" everywhere else in the app (see routes.tsx),
  // so it's checked the same way here.
  useEffect(() => {

    async function loadAll() {

      try {

        const [
          productsData,
          customersData,
          ordersData,
          inventoryData,
          certificatesData
        ] = await Promise.all([
          hasPermission("products.view") ? window.mooral.products.getAll() : Promise.resolve([]),
          hasPermission("customers.view") ? window.mooral.customers.getAll() : Promise.resolve([]),
          hasPermission("orders.view") ? window.mooral.orders.getAll() : Promise.resolve([]),
          hasPermission("products.view") ? window.mooral.inventory.getAll() : Promise.resolve([]),
          hasPermission("certificates.view") ? window.mooral.certificates.getAll() : Promise.resolve([])
        ]);

        setProducts(Array.isArray(productsData) ? productsData : []);
        setCustomers(Array.isArray(customersData) ? customersData : []);
        setOrders(Array.isArray(ordersData) ? ordersData : []);
        setInventory(Array.isArray(inventoryData) ? inventoryData : []);
        setCertificates(Array.isArray(certificatesData) ? certificatesData : []);

      } catch (error) {

        console.error("Global search data load error:", error);

      }

    }

    loadAll();

  }, [user, hasPermission]);

  // Global search scans every product/customer/order/inventory/certificate
  // record on each lookup. Debouncing means that scan only runs once typing
  // pauses, instead of re-scanning all five datasets on every keystroke.
  useEffect(() => {

    const handle = window.setTimeout(() => {
      setDebouncedSearch(search);
    }, 200);

    return () => {
      window.clearTimeout(handle);
    };

  }, [search]);


  useEffect(() => {

    function handleOutsideClick(event: MouseEvent) {

      if (
        profileMenuRef.current &&
        !profileMenuRef.current.contains(event.target as Node)
      ) {
        setProfileMenuOpen(false);
      }

    }

    document.addEventListener("mousedown", handleOutsideClick);

    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
    };

  }, []);


  async function handleLogout(): Promise<void> {

    setProfileMenuOpen(false);

    await logout();

  }


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

  function openInventory(item: any) {
    navigate("/inventory?product_id=" + encodeURIComponent(item.product_id ?? ""));
    setSearch("");
  }

  function openCertificate(certificate: any) {
    if (!certificate.id) return;
    navigate("/certificates?id=" + certificate.id);
    setSearch("");
  }


  const results = useMemo(() => {

    const keyword = debouncedSearch.trim().toLowerCase();

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

    certificates
      .filter((certificate) => {
        const searchable = `
          ${certificate.id ?? ""}
          ${certificate.certificate_id ?? ""}
          ${certificate.employee_name ?? ""}
          ${certificate.customer_name ?? ""}
          ${certificate.product_name ?? ""}
          ${certificate.serial_number ?? ""}
          ${certificate.title ?? ""}
          ${certificate.certificate_type ?? ""}
        `.toLowerCase();
        return searchable.includes(keyword);
      })
      .slice(0, 5)
      .forEach((certificate) => {
        matched.push({
          type: "certificate",
          key: "certificate-" + certificate.id,
          title: certificate.certificate_id,
          subtitle: certificate.certificate_category === "Employee"
            ? `${certificate.employee_name ?? "-"} | ${certificate.certificate_type ?? "-"}`
            : `${certificate.customer_name ?? "-"} | ${certificate.product_name ?? "-"}`,
          onSelect: () => openCertificate(certificate)
        });
      });

    return matched.slice(0, 20);

  }, [debouncedSearch, products, customers, orders, inventory, certificates]);


  return (

    <header className="topbar">

      <div className="search-box topbar-search">

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
                      {t(RESULT_TYPE_KEYS[result.type])}
                    </span>
                  </div>

                  <span>{result.subtitle}</span>

                </div>

              ))

              :

              <div className="search-empty">
                {t("topbar.noMatchingResults")}
              </div>

            }

          </div>

        }

      </div>

      <div className="topbar-actions">

        <div className="profile-menu-wrapper" ref={profileMenuRef}>

          <button
            className="profile-btn"
            onClick={() => setProfileMenuOpen(prev => !prev)}
          >

            {avatarPhoto ? (
              <img className="topbar-avatar-photo" src={avatarPhoto} alt="Profile" />
            ) : (
              <UserCircle size={28} />
            )}

            <div className="profile-identity-chip">
  <strong>
    {user
      ? `${t(USER_TYPE_KEYS[user.user_type] ?? "settingsUserManagement.employee")} - ${user.full_name?.trim() || user.username}`
      : t("topbar.admin")
    }
  </strong>
</div>

          </button>

          {profileMenuOpen ? (

  <div className="profile-dropdown">

  <button 
  className="profile-dropdown-item"
  onClick={() => {
    setProfileMenuOpen(false);
    navigate("/profile");
  }}
>
  {t("topbar.profile")}
</button>


  <button 
    className="profile-dropdown-item"
    onClick={handleLogout}
  >

    <LogOut size={14} />

    {t("topbar.logout")}

  </button>

</div>

) : null}

        </div>

      </div>

    </header>

  );

}
