/**
 * MBS Online Database contract.
 * The server is the source of truth for shared online workspaces.
 * Existing server routes are intentionally preserved.
 */
export const ONLINE_DATABASE_COLLECTIONS = [
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

export type OnlineDatabaseCollection =
  typeof ONLINE_DATABASE_COLLECTIONS[number];

export type OnlineDatabaseOperation =
  | "view"
  | "add"
  | "edit"
  | "delete";

export const ONLINE_DATABASE_OPERATIONS: OnlineDatabaseOperation[] = [
  "view",
  "add",
  "edit",
  "delete",
];

export type OnlineDatabaseRole = "owner" | "admin" | "employee";
