// ===================================================================
// Permission Catalog (shared)
// ===================================================================
//
// The single source of truth for every permission key the app
// understands. Both the renderer's permission engine (./permission-
// engine.ts) and the database seed (src/database/database.ts) are
// built from this same module × action list, so a new module/action
// only ever needs to be added in ONE place.
//
// database.ts can't literally `import` this file (it seeds the table
// from main-process/bundler-neutral code), so its copy of these two
// lists is kept manually in sync -- see the comment above the seed
// block there. Everywhere else in the app (renderer, main process
// IPC handlers) should import from here rather than re-declaring the
// list.
//
// Phase 1 only defines the catalog. Nothing yet assigns these to
// users (that's Phase 2/3) -- the Owner bypasses this entirely via
// hasPermission()'s unrestricted-access short-circuit.

export const PERMISSION_MODULES = [
  "dashboard",
  "products",
  "customers",
  "orders",
  "invoices",
  "inventory",
  "accounting",
  "employees",
  "certificates",
  "reports",
  "settings"
] as const;

export type PermissionModule = (typeof PERMISSION_MODULES)[number];

export const PERMISSION_ACTIONS = [
  "view",
  "create",
  "edit",
  "delete",
  "approve",
  "print",
  "pdf_export"
] as const;

export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

/** e.g. "products.view", "employees.delete" */
export type PermissionKey = `${PermissionModule}.${PermissionAction}`;

export const ALL_PERMISSION_KEYS: PermissionKey[] = PERMISSION_MODULES.flatMap(
  permissionModule =>
    PERMISSION_ACTIONS.map(
      action => `${permissionModule}.${action}` as PermissionKey
    )
);
