export interface NavigationItem {
  id: string;
  title: string;
  path: string;
  /**
   * Which permission-catalog module (see src/auth/permission-catalog.ts)
   * gates this nav item's visibility, checked as `${permissionModule}.view`.
   * Defaults to `id` when omitted -- only items whose id doesn't match a
   * catalog module (e.g. "inventory", which rides on the Products
   * permission) need to set this explicitly.
   */
  permissionModule?: string;
}
