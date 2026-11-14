import type { NavigationItem } from "@/types/navigation";

export const NAVIGATION_ITEMS: NavigationItem[] = [
  { id: "dashboard", title: "Dashboard", path: "/" },
  { id: "customers", title: "Customers", path: "/customers" },
  { id: "products", title: "Products", path: "/products" },
  { id: "inventory", title: "Inventory", path: "/inventory", permissionModule: "products" },
  { id: "orders", title: "Orders", path: "/orders" },
  { id: "invoices", title: "Invoices", path: "/invoices" },
  { id: "accounting", title: "Accounting", path: "/accounting" },
  { id: "reports", title: "Reports", path: "/reports" },
  { id: "employees", title: "Employees", path: "/employees" },
  { id: "certificates", title: "Certificates", path: "/certificates" },
  { id: "settings", title: "Settings", path: "/settings" }
];