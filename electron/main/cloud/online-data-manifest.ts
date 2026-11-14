/**
 * Central online data contract for MBS.
 * The server remains the source of truth for online workspaces.
 */
export const ONLINE_COLLECTIONS = [
  "products",
  "customers",
  "orders",
  "invoices",
  "accounting",
  "inventory",
  "certificates",
  "users",
  "messages",
] as const;

export type OnlineCollection = typeof ONLINE_COLLECTIONS[number];
export type OnlineCrudOperation = "view" | "add" | "edit" | "delete";

export const ONLINE_CRUD_OPERATIONS: OnlineCrudOperation[] = [
  "view",
  "add",
  "edit",
  "delete",
];
