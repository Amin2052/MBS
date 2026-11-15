import { app, BrowserWindow, ipcMain, dialog, nativeImage, shell } from "electron";
import path from "node:path";
import fs from "node:fs";

import { ConfigManager } from "./config";
import { logInfo } from "./logger";
import { loadWindowState, saveWindowState } from "./window-state";
import { loadAppPreferences, setAppPreference, checkForUpdatesNow } from "./app-preferences";
import { renderPdf } from "./pdf-engine";
import { getCloudConfig, getCloudConfigView, setCloudEnabledPreference, setCustomerManagedConfig } from "./cloud/cloud-config-service";
import { licenseManagerV2 } from "./license-v2/license-manager";
import { cloudHealth } from "./cloud/cloud-client";
import { startCloudSync, stopCloudSync, syncCloudNow, getLastSyncState } from "./cloud/cloud-sync-manager";
import { getDatabaseFilePath, closeDatabase } from "../../src/database/database";



import {
  getProducts,
  createProduct,
  updateProduct,
  deleteProduct
} from "../../src/repositories/product-repository";

import {
  recordAuditLog,
  listAuditLogs,
  type AuditModule,
  type AuditAction,
  type AuditLogFilter
} from "../../src/repositories/audit-log-repository";



import {
  getCustomers,
  createCustomer,
  updateCustomer,
  deleteCustomer
} from "../../src/repositories/customer-repository";



import {
  getOrders,
  createOrder,
  updateOrder,
  deleteOrder
} from "../../src/repositories/order-repository";



import {
  getInventoryTransactions,
  stockIn,
  stockOut
} from "../../src/repositories/inventory-repository";




import {
  getTransactions,
  getTransactionById,
  getTransactionSummary,
  createTransaction,
  updateTransaction,
  deleteTransaction,
  getTransactionsByDate
} from "../../src/repositories/accounting-repository";


import {
  getAccounts,
  getAccountSummary,
  getJournalEntries,
  createManualJournalEntry,
  getCustomerLedger,
  getCustomersWithLedgerActivity,
  getGeneralLedger
} from "../../src/repositories/ledger-repository";


import {
  getNotifications,
  createNotification,
  deleteNotification,
  resetNotifications
} from "../../src/repositories/notification-repository";


import {
  getInvoices,
  getInvoiceById,
  getInvoiceSummary,
  updateInvoice,
  deleteInvoice
} from "../../src/repositories/invoice-repository";


import {
  getCertificates,
  getCertificateById,
  getCertificateSummary,
  createCertificate,
  updateCertificate,
  deleteCertificate,
  markCertificatePrinted
} from "../../src/repositories/certificate-repository";


import {
  getCompanySettings,
  updateCompanySettings,
  saveCompanyLogoFromBuffer,
  getCompanyLogoDataUrl,
  removeCompanyLogo
} from "./company-settings-service";


import {
  getEmployees,
  getEmployeeById,
  createEmployee,
  updateEmployee,
  deleteEmployee,
  saveEmployeePhoto,
  removeEmployeePhoto,
  getEmployeePhotoDataUrl
} from "../../src/repositories/employee-repository";

import {
  pickEmployeePhoto,
  pickProfilePhoto,
  decodePhotoDataUrl
} from "./employee-photo-service";

import {
  getContractsByEmployee,
  getCurrentContract,
  createContract,
  extendContract
} from "../../src/repositories/employee-contract-repository";

import {
  EMPLOYEE_DEPARTMENTS,
  EMPLOYEE_DESIGNATIONS,
  EMPLOYEE_STATUS_OPTIONS,
  EMPLOYMENT_TYPE_OPTIONS,
  IDENTITY_TYPE_OPTIONS
} from "../../src/constants/employee";


import {
  getDatabaseInfo,
  createBackup,
  restoreFromBackup,
  vacuumDatabase,
  checkDatabaseIntegrity
} from "./backup-service";


import { registerLicenseIpcV2 } from "./license-v2/ipc";

import {
  checkSetupRequired,
  setupOwnerAccount,
  login,
  logout,
  restoreSession,
  getCurrentUser,
  getActiveSessionUserType,
  changePassword,
  updateProfile,
  getMyProfilePhoto,
  saveMyProfilePhoto,
  removeMyProfilePhoto,
  verifyOwnerRecoveryKey,
  resetOwnerPasswordWithRecoveryKey
} from "./auth/auth-manager";

import {
  requestPasswordReset,
  requestUsernameRecovery,
  approveUsernameRecoveryRequest,
  listPendingPasswordResetRequests,
  listPasswordResetRequestHistory,
  getPasswordResetAuditLog,
  generateResetCodeForRequest,
  redeemPasswordResetCode
} from "./auth/password-reset-manager";

import {
  listMessageableRecipients,
  sendMessage,
  getInbox,
  getSent,
  getUnreadCount,
  openMessage,
  replyToMessage,
  editMessage,
  deleteMessage
} from "./messaging-manager";

import {
  getBusinessMode
} from "./auth/business-mode-service";

import {
  listAllUsers,
  listEmployeesAvailableForLogin,
  createAdministrator,
  createEmployeeLogin,
  disableUser,
  archiveUser,
  restoreUser,
  resetUserPassword,
  changeUserPermissionProfile
} from "./auth/user-manager";

import {
  listPermissionProfiles,
  getProfilePermissionKeys,
  createPermissionProfile,
  updatePermissionProfile,
  deletePermissionProfile,
  resolveUserPermissions
} from "../../src/repositories/permission-profile-repository";

import {
  getSecurityPolicy,
  setSecurityPolicy
} from "./auth/security-policy-service";

import {
  listActiveSessions,
  revokeSession
} from "../../src/repositories/session-repository";

import {
  exportBusinessData,
  importBusinessData,
  type ExportedDataset
} from "./data-transfer-service";

import {
  performErpReset,
  performFactoryReset
} from "./reset-service";

import {
  getResetPreview,
  performCloudBusinessReset,
  performCompleteReset
} from "./cloud/cloud-reset-service";

import { verifyActiveUserPassword } from "./auth/auth-manager";

import {
  requirePermission,
  requireUserType,
  requireUserTypeAllowUnlicensed
} from "./auth/authorization";





const isDev = !app.isPackaged;



let mainWindow: BrowserWindow | null = null;

// Tracks the isolated print target used by the MBS custom preview. The
// target is created only after the user confirms Print and is never exposed
// as a second visible preview window.
let activePrintPreviewWindow: BrowserWindow | null = null;

function closeActivePrintPreviewWindow(): void {
  const win = activePrintPreviewWindow;
  activePrintPreviewWindow = null;

  if (win && !win.isDestroyed()) {
    try {
      win.close();
    } catch {
      // Best-effort cleanup.
    }
  }
}

// Ensures the HTML loaded into the isolated print target always has a
// real <title>, so document.title (and therefore the window/print-dialog
// caption) never falls back to Electron's hard-coded default "Electron".
// The printed HTML is normally a body-only fragment, so in the common case
// this just prepends a minimal <head><title> before it.
function ensureHtmlHasTitle(html: string, fallbackTitle: string): string {
  if (/<title[\s>]/i.test(html)) {
    return html;
  }

  const escaped = fallbackTitle
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  if (/<head(\s[^>]*)?>/i.test(html)) {
    return html.replace(/<head(\s[^>]*)?>/i, (match) => `${match}<title>${escaped}</title>`);
  }

  return `<head><title>${escaped}</title></head>${html}`;
}

// Licensing (v2) is registered further down, after requireUserType is
// available — see registerLicenseIpcV2() near the other IPC handlers.
// The old HMAC-based LicenseManager has been retired; see
// /_deprecated_old_license for reference only.







// ===============================
// AUDIT LOG HELPER
// ===============================
//
// Thin wrapper around recordAuditLog() that pulls the current session
// user so individual IPC handlers below don't each have to. Called
// right after a create/edit/delete succeeds (never before -- an audit
// row should only exist for a change that actually happened) for every
// module Phase 7 requires: Products, Customers, Orders, Inventory,
// Certificates, Employees, User/Permission changes, Settings changes.
// A logging failure must never fail the underlying operation, so this
// is deliberately fire-and-forget with its own try/catch.
function logAudit(
  module: AuditModule,
  action: AuditAction,
  recordId: string | number | null | undefined,
  recordLabel: string | null | undefined,
  oldValue?: unknown,
  newValue?: unknown
): void {

  try {

    const user = getCurrentUser();

    recordAuditLog({
      userId: user?.id ?? null,
      username: user?.username ?? null,
      userType: user?.user_type ?? null,
      module,
      action,
      recordId,
      recordLabel,
      oldValue,
      newValue
    });

  } catch (error) {

    console.error(`Failed to record audit log entry (${module}.${action}):`, error);

  }

}



// ===============================
// AUTHENTICATION IPC HANDLERS
// ===============================
//
// Phase 1 (Authentication Foundation): Owner-only. checkSetupRequired
// / setupOwner gate the First-Time Setup Wizard; login / logout /
// restoreSession / getCurrentUser / changePassword back the Login
// screen and AuthContext. Every handler here validates its own input
// -- the same convention as every other IPC handler in this file --
// rather than trusting the renderer.

ipcMain.handle(
  "auth:checkSetupRequired",
  () => {

    return checkSetupRequired();

  }
);



ipcMain.handle(
  "auth:setupOwner",
  async (_event, data) => {

    if (!data || typeof data.username !== "string" || typeof data.password !== "string") {
      throw new Error("Username and password are required.");
    }

    return setupOwnerAccount(data.username, data.password);

  }
);



ipcMain.handle(
  "auth:login",
  async (_event, data) => {

    if (!data || typeof data.username !== "string" || typeof data.password !== "string") {
      throw new Error("Username and password are required.");
    }

    return login(
      data.username,
      data.password,
      Boolean(data.rememberMe)
    );

  }
);



ipcMain.handle(
  "auth:logout",
  () => {

    return logout();

  }
);



ipcMain.handle(
  "auth:restoreSession",
  () => {

    return restoreSession();

  }
);



ipcMain.handle(
  "auth:getCurrentUser",
  () => {

    return getCurrentUser();

  }
);



ipcMain.handle(
  "auth:changePassword",
  async (_event, data) => {

    if (!data || typeof data.currentPassword !== "string" || typeof data.newPassword !== "string") {
      throw new Error("Current and new password are required.");
    }

    return changePassword(data.currentPassword, data.newPassword);

  }
);



// ===============================
// EDIT PROFILE / PROFILE PICTURE
// ===============================

ipcMain.handle(
  "auth:updateProfile",
  async (_event, data) => {

    if (!data || typeof data.username !== "string") {
      throw new Error("A username is required.");
    }

    // Designation/Job Title can only be changed by the Owner or by
    // someone holding the employees.edit permission (the app's closest
    // existing equivalent to "HR") -- enforced here, server-side, not
    // just by the renderer disabling the input. A normal user whose
    // designation is unchanged never hits this branch at all.
    if (typeof data.designation === "string") {

      const requester = getCurrentUser();

      if (!requester) {
        throw new Error("You must be signed in to perform this action.");
      }

      if (
        data.designation.trim() !== (requester.designation ?? "").trim() &&
        requester.user_type !== "owner"
      ) {
        requirePermission("employees.edit");
      }

    }

    return updateProfile({
      username: data.username,
      fullName: typeof data.fullName === "string" ? data.fullName : undefined,
      email: typeof data.email === "string" ? data.email : undefined,
      phone: typeof data.phone === "string" ? data.phone : undefined,
      designation: typeof data.designation === "string" ? data.designation : undefined
    });

  }
);



ipcMain.handle(
  "auth:getMyProfilePhoto",
  () => {

    return getMyProfilePhoto();

  }
);



ipcMain.handle(
  "auth:pickProfilePhoto",
  async () => {

    return pickProfilePhoto(mainWindow);

  }
);



ipcMain.handle(
  "auth:saveProfilePhoto",
  (_event, data) => {

    if (!data || typeof data.photoDataUrl !== "string") {
      throw new Error("A photo is required.");
    }

    const decoded = decodePhotoDataUrl(data.photoDataUrl);

    if (!decoded) {
      throw new Error("Invalid photo data.");
    }

    return saveMyProfilePhoto(decoded.buffer, decoded.mime);

  }
);



ipcMain.handle(
  "auth:removeProfilePhoto",
  () => {

    return removeMyProfilePhoto();

  }
);



// Forgot Username is now handled entirely by the offline Account
// Recovery workflow below (passwordReset:requestUsername +
// passwordReset:approveUsername) -- identity is verified against a
// Citizen ID/Residence ID number + Date of Birth instead of full
// name + contact, and the username is delivered via internal Message
// after Administrator/Owner review, rather than revealed instantly.



// Resolves the logged-in user's flat permission set (profile baseline
// + per-user overrides). Owner/Administrator get null -- their access
// is unrestricted by design (see src/auth/permission-engine.ts) and
// resolving a set for them would be meaningless overhead on every
// login/session restore.
ipcMain.handle(
  "auth:getMyPermissions",
  () => {

    const user = getCurrentUser();

    if (!user || user.user_type !== "employee") {
      return null;
    }

    return Array.from(resolveUserPermissions(user.id, user.permission_profile_id));

  }
);



// ===============================
// FORGOT PASSWORD WORKFLOW (Task 2)
// ===============================
//
// requestPasswordReset / redeemPasswordResetCode run with no active
// session (called from the Login screen, same as auth:login above).
// listPendingPasswordResetRequests / generateResetCode re-check the
// caller's user_type inside password-reset-manager.ts itself, same
// convention as USER MANAGEMENT handlers below.

ipcMain.handle(
  "passwordReset:request",
  (_event, data) => {

    if (
      !data ||
      typeof data.identityNumber !== "string" ||
      typeof data.dateOfBirth !== "string" ||
      typeof data.employeeId !== "string"
    ) {
      throw new Error("Employee Number, Citizen/Resident Number and Date of Birth are required.");
    }

    return requestPasswordReset(data.identityNumber, data.dateOfBirth, data.employeeId);

  }
);

ipcMain.handle(
  "passwordReset:requestUsername",
  (_event, data) => {

    if (
      !data ||
      typeof data.identityNumber !== "string" ||
      typeof data.dateOfBirth !== "string" ||
      typeof data.employeeId !== "string"
    ) {
      throw new Error("Employee Number, Citizen/Resident Number and Date of Birth are required.");
    }

    return requestUsernameRecovery(data.identityNumber, data.dateOfBirth, data.employeeId);

  }
);

ipcMain.handle(
  "passwordReset:approveUsername",
  async (_event, requestId) => {

    if (typeof requestId !== "number") {
      throw new Error("A request id is required.");
    }

    return approveUsernameRecoveryRequest(requestId);

  }
);



ipcMain.handle(
  "passwordReset:listPending",
  () => {

    return listPendingPasswordResetRequests();

  }
);



ipcMain.handle(
  "passwordReset:listHistory",
  () => {

    return listPasswordResetRequestHistory();

  }
);



ipcMain.handle(
  "passwordReset:auditLog",
  (_event, requestId) => {

    if (typeof requestId !== "number") {
      throw new Error("A request id is required.");
    }

    return getPasswordResetAuditLog(requestId);

  }
);



ipcMain.handle(
  "passwordReset:generateCode",
  async (_event, requestId) => {

    if (typeof requestId !== "number") {
      throw new Error("A request id is required.");
    }

    return generateResetCodeForRequest(requestId);

  }
);



ipcMain.handle(
  "passwordReset:redeem",
  async (_event, data) => {

    if (
      !data ||
      typeof data.username !== "string" ||
      typeof data.resetCode !== "string" ||
      typeof data.newPassword !== "string"
    ) {
      throw new Error("Username, reset code, and new password are required.");
    }

    return redeemPasswordResetCode(data.username, data.resetCode, data.newPassword);

  }
);



ipcMain.handle(
  "passwordReset:verifyOwnerRecoveryKey",
  async (_event, data) => {

    if (!data || typeof data.username !== "string" || typeof data.recoveryKey !== "string") {
      throw new Error("Username and Recovery Key are required.");
    }

    return verifyOwnerRecoveryKey(data.username, data.recoveryKey);

  }
);



ipcMain.handle(
  "passwordReset:resetOwnerWithRecoveryKey",
  async (_event, data) => {

    if (
      !data ||
      typeof data.username !== "string" ||
      typeof data.recoveryKey !== "string" ||
      typeof data.newPassword !== "string"
    ) {
      throw new Error("Username, Recovery Key, and new password are required.");
    }

    return resetOwnerPasswordWithRecoveryKey(data.username, data.recoveryKey, data.newPassword);

  }
);



// ===============================
// BUSINESS MODE IPC HANDLER
// ===============================
//
// SECURITY (Phase 5): there is deliberately no "businessMode:set"
// handler. Business Mode can only change by activating a different
// signed license (see license-v2/ipc.ts) -- getBusinessMode() reads
// that validated entitlement, never anything client-editable. A
// previous "businessMode:set" handler here let any Owner flip a
// company_settings column directly; that was a second, insecure
// entitlement path and has been removed along with its UI.

ipcMain.handle(
  "businessMode:get",
  () => {

    return getBusinessMode();

  }
);



// ===============================
// SECURITY POLICIES (Phase 5)
// ===============================

ipcMain.handle(
  "securityPolicy:get",
  () => {

    return getSecurityPolicy();

  }
);



ipcMain.handle(
  "securityPolicy:set",
  (_event, policy) => {

    if (getActiveSessionUserType() !== "owner") {
      throw new Error("Only the Owner can change Security Policies.");
    }

    if (!policy || typeof policy.maxLoginAttempts !== "number" || typeof policy.lockoutMinutes !== "number") {
      throw new Error("A max login attempts and lockout duration are required.");
    }

    setSecurityPolicy(policy);

    return { success: true };

  }
);



// ===============================
// ACTIVE SESSIONS (Phase 8: Session Management)
// ===============================
//
// Owner/Administrator only -- lets them see who is currently logged
// in (including Remember Me sessions persisted on other devices) and
// force-end a specific session, e.g. after a shared/lost device.
// Ending a session here does not disable the account, only that one
// session -- the person can simply log back in, same as "Sign out
// instead" on the Lock Screen.

ipcMain.handle(
  "sessions:list",
  () => {

    if (getActiveSessionUserType() !== "owner" && getActiveSessionUserType() !== "administrator") {
      throw new Error("You do not have access to Active Sessions.");
    }

    return listActiveSessions();

  }
);



ipcMain.handle(
  "sessions:revoke",
  (_event, sessionId: number) => {

    const callerType = getActiveSessionUserType();

    if (callerType !== "owner" && callerType !== "administrator") {
      throw new Error("You do not have access to Active Sessions.");
    }

    if (typeof sessionId !== "number") {
      throw new Error("A session id is required.");
    }

    // Administrators may not force-end an Owner's session -- consistent
    // with every other Owner-protection guard in the app (see
    // assertCanManageTarget in auth/user-manager.ts).
    if (callerType === "administrator") {

      const target = listActiveSessions().find(s => s.id === sessionId);

      if (target?.user_type === "owner") {
        throw new Error("Administrators cannot end the Owner's session.");
      }

    }

    revokeSession(sessionId);

    logAudit("permissions", "edit", sessionId, "Session ended", null, null);

    return { success: true };

  }
);



// ===============================
// DATA IMPORT / EXPORT (Phase 5)
// ===============================
//
// Owner-only, matching every other Owner Control Center capability.
// Export writes straight to a chosen file (no renderer round-trip of
// the payload needed); Import reads and parses the chosen file here
// in the main process, where the database connection lives.

ipcMain.handle(
  "data:export",
  async () => {

    if (getActiveSessionUserType() !== "owner") {
      throw new Error("Only the Owner can export data.");
    }

    if (!mainWindow) {
      return { success: false };
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

    const { canceled, filePath } = await dialog.showSaveDialog(
      mainWindow,
      {
        title: "Export Business Data",
        defaultPath: `mooral-data-export-${timestamp}.json`,
        filters: [
          { name: "JSON Files", extensions: ["json"] }
        ]
      }
    );

    if (canceled || !filePath) {
      return { success: false, cancelled: true };
    }

    try {

      const dataset = exportBusinessData();

      fs.writeFileSync(filePath, JSON.stringify(dataset, null, 2), "utf-8");

      return { success: true, filePath };

    }
    catch (error) {

      console.error("DATA EXPORT FAILED", error);

      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error during export."
      };

    }

  }
);



ipcMain.handle(
  "data:import",
  async () => {

    if (getActiveSessionUserType() !== "owner") {
      throw new Error("Only the Owner can import data.");
    }

    if (!mainWindow) {
      return { success: false };
    }

    const { canceled, filePaths } = await dialog.showOpenDialog(
      mainWindow,
      {
        title: "Import Business Data",
        properties: ["openFile"],
        filters: [
          { name: "JSON Files", extensions: ["json"] }
        ]
      }
    );

    if (canceled || filePaths.length === 0) {
      return { success: false, cancelled: true };
    }

    try {

      const raw = fs.readFileSync(filePaths[0], "utf-8");
      const dataset = JSON.parse(raw) as ExportedDataset;

      return importBusinessData(dataset);

    }
    catch (error) {

      console.error("DATA IMPORT FAILED", error);

      return {
        success: false,
        error: error instanceof Error ? error.message : "This file could not be read as a data export."
      };

    }

  }
);



// ===============================
// ERP RESET / FACTORY RESET (Phase 5)
// ===============================
//
// Owner-only. Per spec, no additional native confirmation dialog --
// the renderer's 15-second countdown flow (owner-control-center.tsx)
// is the confirmation. Both relaunch the app afterward on success,
// the same pattern already used by database:restore above, since a
// full data wipe leaves every open window's in-memory state stale.

ipcMain.handle(
  "erp:reset",
  () => {

    if (getActiveSessionUserType() !== "owner") {
      throw new Error("Only the Owner can reset the ERP.");
    }

    const result = performErpReset();

    if (result.success) {

      setTimeout(
        () => {
          app.relaunch();
          app.exit(0);
        },
        500
      );

    }

    return result;

  }
);



ipcMain.handle(
  "erp:factoryReset",
  () => {

    if (getActiveSessionUserType() !== "owner") {
      throw new Error("Only the Owner can perform a Factory Reset.");
    }

    const result = performFactoryReset();

    if (result.success) {

      setTimeout(
        () => {
          app.relaunch();
          app.exit(0);
        },
        500
      );

    }

    return result;

  }
);



// ===============================
// CLOUD-AWARE RESET (local / central / complete)
// ===============================
//
// These are separate from erp:reset and erp:factoryReset above on purpose:
// those two only ever touched this device's SQLite file, while these can also
// delete the company's CENTRAL records. They therefore add two gates the
// legacy handlers never had:
//
//   1. the owner's password, re-entered in the dialog and verified against
//      the current session's real hash (verifyActiveUserPassword) -- an
//      unlocked, logged-in PC is not by itself enough to wipe the company's
//      central data;
//   2. an exact typed confirmation (workspace id for a central reset,
//      "RESET" for a complete one), enforced here, not only in the UI.
//
// Nothing is deleted until a real SQLite backup has been written; see
// cloud-reset-service.ts. All three relaunch on success for the same reason
// the legacy handlers do: every open window holds stale in-memory state.

function relaunchAfterReset(): void {
  setTimeout(() => {
    app.relaunch();
    app.exit(0);
  }, 500);
}

ipcMain.handle("reset:preview", async () => {
  requireUserType("owner");
  return getResetPreview();
});

ipcMain.handle("reset:local", async (_event, data) => {
  requireUserType("owner");
  if (!(await verifyActiveUserPassword(String(data?.password || "")))) {
    return { success: false, error: "Password is incorrect. Nothing was reset." };
  }
  const result = performErpReset();
  if (result.success) {
    logAudit("settings", "delete", null, "Local ERP reset (this device only)");
    relaunchAfterReset();
  }
  return result;
});

ipcMain.handle("reset:cloud", async (_event, data) => {
  requireUserType("owner");
  if (!(await verifyActiveUserPassword(String(data?.password || "")))) {
    return { success: false, error: "Password is incorrect. Nothing was reset." };
  }
  const result = await performCloudBusinessReset({ confirmWorkspace: String(data?.confirmWorkspace || "") });
  if (result.success) {
    logAudit("settings", "delete", null, `Central business data reset (epoch ${result.resetEpoch ?? 0})`, null, { backupPath: result.backupPath, deleted: result.deleted });
    relaunchAfterReset();
  }
  return result;
});

ipcMain.handle("reset:complete", async (_event, data) => {
  requireUserType("owner");
  if (!(await verifyActiveUserPassword(String(data?.password || "")))) {
    return { success: false, error: "Password is incorrect. Nothing was reset." };
  }
  const result = await performCompleteReset({ confirmation: String(data?.confirmation || "") });
  if (result.success) {
    logAudit("settings", "delete", null, `Complete reset (local + central, epoch ${result.resetEpoch ?? 0})`, null, { backupPath: result.backupPath });
    relaunchAfterReset();
  }
  return result;
});



// ===============================
// USER MANAGEMENT IPC HANDLERS (Phase 2 - Enterprise Foundation)
// ===============================
//
// Authorization is enforced inside user-manager.ts itself (it reads
// the active session via auth-manager's getActiveSessionUserType()),
// not here -- these handlers just validate the shape of the input,
// same convention as the AUTHENTICATION handlers above.

ipcMain.handle(
  "users:list",
  () => {

    return listAllUsers();

  }
);



ipcMain.handle(
  "users:employeesAvailableForLogin",
  () => {

    return listEmployeesAvailableForLogin();

  }
);



ipcMain.handle(
  "users:createAdministrator",
  async () => {

    const result = await createAdministrator();

    logAudit("permissions", "create", (result as { user?: { id?: number } })?.user?.id, "Administrator account created");

    return result;

  }
);



ipcMain.handle(
  "users:createEmployeeLogin",
  async (_event, data) => {

    if (!data || typeof data.employeeId !== "number" || typeof data.permissionProfileId !== "number") {
      throw new Error("An employee and a permission profile are required.");
    }

    const result = await createEmployeeLogin(data.employeeId, data.permissionProfileId);

    logAudit("permissions", "create", (result as { user?: { id?: number } })?.user?.id, "Employee login created", null, { employeeId: data.employeeId, permissionProfileId: data.permissionProfileId });

    return result;

  }
);



ipcMain.handle(
  "users:disable",
  (_event, userId) => {

    if (typeof userId !== "number") {
      throw new Error("A user id is required.");
    }

    const result = disableUser(userId);

    logAudit("permissions", "edit", userId, "User disabled", null, { status: "disabled" });

    return result;

  }
);



ipcMain.handle(
  "users:archive",
  (_event, userId) => {

    if (typeof userId !== "number") {
      throw new Error("A user id is required.");
    }

    const result = archiveUser(userId);

    logAudit("permissions", "edit", userId, "User archived", null, { status: "archived" });

    return result;

  }
);



ipcMain.handle(
  "users:restore",
  (_event, userId) => {

    if (typeof userId !== "number") {
      throw new Error("A user id is required.");
    }

    const result = restoreUser(userId);

    logAudit("permissions", "edit", userId, "User restored", null, { status: "active" });

    return result;

  }
);



ipcMain.handle(
  "users:resetPassword",
  async (_event, userId) => {

    if (typeof userId !== "number") {
      throw new Error("A user id is required.");
    }

    const result = await resetUserPassword(userId);

    logAudit("permissions", "edit", userId, "Password reset", null, null);

    return result;

  }
);


ipcMain.handle(
  "users:changePermissionProfile",
  async (_event, data: { userId: number; permissionProfileId: number }) => {

    if (typeof data?.userId !== "number" || typeof data?.permissionProfileId !== "number") {
      throw new Error("A user id and permission profile id are required.");
    }

    const result = changeUserPermissionProfile(data.userId, data.permissionProfileId);

    logAudit("permissions", "edit", data.userId, "Permission profile changed", null, { permissionProfileId: data.permissionProfileId });

    return result;

  }
);



// ===============================
// CREDENTIAL PDF EXPORT (Phase 4)
// ===============================
//
// Same pattern as invoices:exportPdf / certificates:exportPdf: the
// renderer builds the printable credential HTML (company logo, name,
// username, temporary password, permission summary, security notice
// -- see src/components/auth/credential-print-template.ts), this
// handler renders it off-screen and saves it as a real PDF via
// Electron's printToPDF. Uses the temp-file + image/font wait variant
// (like invoices) rather than the simpler data-URL variant (like
// certificates) because the company logo must reliably render.

ipcMain.handle(
  "credentials:exportPdf",
  async (_event, data: { html: string; fileName: string }) => {
    // SECURITY (IPC audit): unlike its sibling reports:exportPdf (which
    // correctly calls requirePermission("reports.view")), this had no
    // auth check at all -- any caller could trigger a PDF render of
    // arbitrary attacker-controlled HTML. Matching the sibling's bar.
    requireUserType("owner", "administrator", "employee");
    return renderPdf({
      html: data.html,
      fileName: data.fileName,
      dialogTitle: "Save Credentials as PDF",
      pageSize: "A4"
    });
  }
);


// ===============================
// REPORTS PDF EXPORT (Task 11)
// ===============================
//
// Same pattern as invoices:exportPdf / certificates:exportPdf /
// credentials:exportPdf: the renderer builds the printable report HTML
// (see buildReportHtml in reports-page.tsx), this handler renders it
// off-screen and saves it as a real PDF file via Electron's printToPDF,
// instead of relying on the browser's interactive print dialog.

ipcMain.handle(
  "reports:exportPdf",
  async (_event, data: { html: string; fileName: string }) => {
    requirePermission("reports.view");

    return renderPdf({
      html: data.html,
      fileName: data.fileName,
      dialogTitle: "Export Report as PDF",
      pageSize: "A4"
    });
  }
);


// ===============================
// PRINT PREVIEW (Invoices, Certificates, Credentials)
// ===============================
// The renderer shows the user-visible preview -- printer, orientation,
// pages, and copies are all chosen there. The main process creates a
// hidden (show:false) print target only when Print is confirmed, waits
// for its document to settle, then calls webContents.print() with
// silent:true against that exact document using the settings the user
// already picked in-app. Printing silently, rather than silent:false,
// is deliberate: silent:false would open the Windows native print dialog
// as its own separate top-level window on top of MBS's own preview --
// asking the user to re-pick settings they'd already chosen, and the
// window this app previously ran under had no proper OS identity set, so
// that dialog showed up captioned "Electron - Print", which read as a
// confusing, unwanted second window. See the app-identity block near
// app.whenReady() for the (separate, still-applied) fix for that
// captioning, and ensureHtmlHasTitle() for the print target's own title.
// This whole approach also avoids window.open/window.print races.

interface RendererPrintSettings {
  deviceName?: string;
  landscape?: boolean;
  copies?: number;
  color?: boolean;
  collate?: boolean;
  duplexMode?: "simplex" | "longEdge" | "shortEdge";
  printBackground?: boolean;
  pageSize?: "A4" | "A3" | "A5" | "Legal" | "Letter";
  scaleFactor?: number;
  pages?: "all" | "current" | "custom";
  pageRangeText?: string;
  currentPage?: number;
}

// Parses the "Custom range" text field (e.g. "1-5, 8, 11-13") into the
// 0-indexed {from,to} pairs webContents.print()'s pageRanges option
// expects. Silently drops tokens that don't parse or fall outside
// 1..maxPage rather than throwing, since this runs on every Print
// click and a stray character in the field should never block
// printing -- it should just be ignored, the same way most print
// dialogs behave.
function parsePageRanges(
  text: string,
  maxPage: number
): Array<{ from: number; to: number }> | undefined {

  const ranges: Array<{ from: number; to: number }> = [];

  for (const rawToken of text.split(",")) {

    const token = rawToken.trim();

    if (!token) {
      continue;
    }

    const dashMatch = token.match(/^(\d+)\s*-\s*(\d+)$/);
    const singleMatch = token.match(/^(\d+)$/);

    let start: number | null = null;
    let end: number | null = null;

    if (dashMatch) {
      start = parseInt(dashMatch[1], 10);
      end = parseInt(dashMatch[2], 10);
    } else if (singleMatch) {
      start = parseInt(singleMatch[1], 10);
      end = start;
    }

    if (start === null || end === null) {
      continue;
    }

    if (start > end) {
      [start, end] = [end, start];
    }

    start = Math.max(1, start);
    end = Math.min(maxPage, end);

    if (start > maxPage || end < 1 || start > end) {
      continue;
    }

    ranges.push({ from: start - 1, to: end - 1 });

  }

  return ranges.length > 0 ? ranges : undefined;

}

ipcMain.handle(
  "print-preview:getPrinters",
  async () => {

    const win = activePrintPreviewWindow ?? mainWindow;

    if (!win || win.isDestroyed()) {
      return [];
    }

    try {
      const printers = await win.webContents.getPrintersAsync();
      return printers.map(p => ({
        name: p.name,
        displayName: p.displayName || p.name,
        isDefault: Boolean(p.isDefault)
      }));
    } catch {
      // getPrintersAsync can throw on some platforms/driver states --
      // an empty list lets the UI fall back to "system default"
      // instead of crashing the settings panel.
      return [];
    }

  }
);

// ===============================
// CLOUD / ONLINE DATABASE IPC
// ===============================

// In developer_managed mode, apiUrl/workspaceId/apiKey are developer
// property carried inside the signed license (see cloud-config-service.ts)
// -- never returned to, or settable by, the renderer; the renderer only
// sees a masked status view and can only toggle the local "enabled"
// preference. In customer_managed mode, the license grants only the
// *entitlement*; the customer's own apiUrl/workspaceId/apiKey are entered
// by them, returned to the renderer in full, and saved locally via
// cloud:saveCustomerConfig (which independently re-checks that the active
// license actually grants customer_managed before accepting them).
// SECURITY (IPC audit): all five of these used to have NO authentication
// check at all -- reachable even before any login, from any renderer JS.
// getConfig in particular returns the RAW PLAINTEXT customer-managed API
// key (see getCloudConfigView() in cloud-config-service.ts -- it's
// intentionally included, unmasked, so the Settings > Integrations page
// can pre-fill an editable field for whoever configured it), which made
// this a straightforward secret-disclosure path for any script that could
// reach the IPC bridge. saveCustomerConfig is the most sensitive of the
// five: it changes WHERE this installation sends every future push of
// the company's product/customer/employee/financial data, so an
// unauthenticated caller could silently redirect the company's entire
// cloud sync stream to a server they control. Gated to Owner (the same
// bar as Database Backup/Restore and Factory Reset -- comparable
// blast radius). getConfig/saveConfig also Owner-gated, since both
// expose or change this same security-sensitive infrastructure config.
// syncNow/health are lower-risk (trigger a sync / read a status), but
// still gated to require SOME active session -- no legitimate reason for
// either to be callable pre-login.
ipcMain.handle("cloud:getConfig", () => {
  requireUserType("owner");
  return getCloudConfigView();
});

ipcMain.handle("cloud:saveConfig", (_event, config) => {
  requireUserType("owner");
  if (!config || typeof config !== "object") throw new Error("Invalid cloud configuration.");
  setCloudEnabledPreference(Boolean(config.enabled));
  return getCloudConfigView();
});

// Lets the customer store their own personal/self-hosted server details
// locally -- only when the active, signature-verified license actually
// grants a "customer_managed" cloud entitlement. A license without that
// entitlement (no cloud, or a developer_managed one) must never accept a
// customer-supplied replacement here.
ipcMain.handle("cloud:saveCustomerConfig", (_event, config) => {
  requireUserType("owner");
  const licensed = licenseManagerV2.getVerifiedCloudConfig();
  if (!licensed || !licensed.enabled || licensed.mode !== "customer_managed") {
    throw new Error("This license does not permit a customer-managed cloud server.");
  }
  if (!config || typeof config !== "object") throw new Error("Invalid cloud configuration.");
  setCustomerManagedConfig({
    apiUrl: typeof config.apiUrl === "string" ? config.apiUrl : "",
    workspaceId: typeof config.workspaceId === "string" ? config.workspaceId : "",
    apiKey: typeof config.apiKey === "string" ? config.apiKey : ""
  });
  return getCloudConfigView();
});

ipcMain.handle("cloud:syncNow", async () => {
  requireUserType("owner", "administrator", "employee");
  try {
    if (!getCloudConfig().enabled) return { success: false, error: "Cloud sync is disabled." };
    await syncCloudNow();
    // syncOnce() (inside syncCloudNow) now isolates per-user/permission
    // errors internally and never throws for them -- that's correct for
    // not blocking unrelated business-data sync, but it means this handler
    // can no longer infer failure from a caught exception alone. Read back
    // the state syncOnce() just persisted so a real users/permissions
    // failure (e.g. Worker rejected the payload, network error) is still
    // reported here instead of silently reading as a plain success.
    const state = await getLastSyncState();
    const userErrors = Array.isArray(state?.userErrors) ? state!.userErrors as unknown[] : [];
    const permissionsError = typeof state?.permissionsError === "string" ? state!.permissionsError as string : null;
    if (userErrors.length || permissionsError) {
      return { success: false, error: permissionsError ?? `${userErrors.length} user(s) failed to sync.`, userErrors, permissionsError, state };
    }
    return { success: true, state };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle("cloud:health", async () => {
  requireUserType("owner", "administrator", "employee");
  try {
    if (!getCloudConfig().enabled) return { success: false, detail: "Cloud sync is disabled." };
    return await cloudHealth();
  } catch (error) {
    return { success: false, detail: error instanceof Error ? error.message : String(error) };
  }
});

// SECURITY: cloud:listRecords / createRecord / updateRecord / deleteRecord
// were removed here (IPC-security audit). They took a renderer-supplied
// TABLE NAME and RECORD/PATCH payload and proxied it directly to the
// Worker using this installation's cloud API key -- with NO
// authentication check (reachable even pre-login) and NO authorization
// check (an Employee session could write to `accounts`/`journal_entries`
// etc., completely bypassing every local RBAC check every other IPC
// handler in this file enforces). Confirmed via grep across the entire
// `src/` renderer tree that neither the preload bridge exposure nor any
// UI component ever actually called any of these four -- they were dead,
// unused surface that was nonetheless fully reachable from any renderer
// JS (devtools console, a compromised dependency, etc. -- Electron's
// contextBridge exposes `window.api.cloud.*` to any page-context script
// equally). Removed entirely rather than retrofitted with auth: even
// WITH an auth check, a fully generic "any table, any operation" proxy
// bypasses the field validation, business-key handling, and audit
// logging that the real per-feature IPC handlers (products:create,
// customers:update, etc.) already do correctly, so keeping it around --
// authenticated or not -- would still be worse than the domain-specific
// handlers that already exist for every real feature. If a genuine future
// need arises for renderer-triggered cloud record access, it should go
// through a purpose-built, permission-scoped handler for that specific
// table, not a generic passthrough.

ipcMain.handle(
  "print-preview:openPrinterSettings",
  async () => {

    try {
      if (process.platform === "win32") {
        await shell.openExternal("ms-settings:printers");
        return { success: true };
      }
      // No equivalent honest deep-link on macOS/Linux across
      // distributions -- rather than guess at a shell command that
      // might not exist on the user's system, report this as
      // unsupported so the UI can say so instead of silently doing
      // nothing.
      return { success: false, error: "Not supported on this platform." };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }

  }
);

ipcMain.handle(
  "print-preview:addPrinter",
  async () => {

    try {
      if (process.platform !== "win32") {
        return { success: false, error: "Not supported on this platform." };
      }

      // Windows owns printer-driver installation. MBS opens the real
      // Windows Printers page so the customer can use “Add device” to
      // install a USB, network, or shared printer. Once installed,
      // getPrintersAsync() automatically exposes it in MBS's printer list.
      await shell.openExternal("ms-settings:printers");
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }

  }
);

ipcMain.handle(
  "print-preview:create",
  async (_event, data: { html: string; documentLabel?: string }) => {
    if (!data?.html || typeof data.html !== "string") {
      return { success: false, error: "Print document is empty." };
    }

    closeActivePrintPreviewWindow();

    // ROOT CAUSE (second "Electron Print" window): this target was created
    // with show:false and never shown. On Windows, the native print dialog
    // spawned by webContents.print() is owned/parented by the target
    // BrowserWindow's actual OS window handle -- but a BrowserWindow that
    // is created hidden and never shown never gets that handle properly
    // realized/activated. Windows then can't parent the dialog to it and
    // instead spawns the dialog as its own independent top-level window,
    // captioned with Electron's hard-coded default title ("Electron")
    // because this window's title was also never explicitly set (the
    // printed HTML is a body-only fragment with no <title>, so
    // document.title is empty). That stray, independently-captioned
    // window is what showed up as "Electron Print".
    //
    // Historical note (why this target used to be created show:true /
    // opacity:0 instead of show:false): that dance existed only to let
    // Windows correctly parent the *native OS print dialog* to this
    // window. Now that printing below always uses silent:true (see the
    // "print-preview:print" handler), no native dialog is ever opened, so
    // that concern no longer applies -- show:false is simplest and safest.
    // The explicit title is still set (and the HTML still gets a <title>
    // via ensureHtmlHasTitle) purely for hygiene, in case anything ever
    // reads it.
    const title = (data.documentLabel && data.documentLabel.trim()) || "Mooral Business Suite";

    const win = new BrowserWindow({
      parent: mainWindow ?? undefined,
      title,
      show: false,
      width: 794,
      height: 1123,
      autoHideMenuBar: true,
      skipTaskbar: true,
      backgroundColor: "#ffffff",
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });

    activePrintPreviewWindow = win;

    win.on("closed", () => {
      if (activePrintPreviewWindow === win) {
        activePrintPreviewWindow = null;
      }
    });

    // Ensure the OS-level title (used as the fallback caption for any
    // window/dialog owned by this one, including the native print dialog)
    // is set before any content loads and can never regress to the
    // Electron default.
    win.setTitle(title);

    const finalHtml = ensureHtmlHasTitle(data.html, title);

    try {
      await win.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(finalHtml)}`);
      return { success: true };
    } catch (error) {
      if (activePrintPreviewWindow === win) {
        activePrintPreviewWindow = null;
      }
      if (!win.isDestroyed()) {
        win.close();
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
);

ipcMain.handle(
  "print-preview:print",
  async (_event, settings?: RendererPrintSettings) => {
    const win = activePrintPreviewWindow;

    if (!win || win.isDestroyed()) {
      return { success: false, error: "Print target window is not available." };
    }

    if (win.webContents.isLoading()) {
      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          win.webContents.removeListener("did-finish-load", finish);
          resolve();
        };
        win.webContents.once("did-finish-load", finish);
        setTimeout(finish, 3000);
      });
    }

    if (win.isDestroyed()) {
      return { success: false, error: "Print target window was closed." };
    }

    // Ensure the exact print document has completed image/font loading and
    // at least two compositor frames before handing it to Chromium's print
    // pipeline. This runs in the target renderer, not the preview iframe.
    try {
      await win.webContents.executeJavaScript(`
        (async () => {
          const deadline = Date.now() + 5000;
          while (Date.now() < deadline) {
            const images = Array.from(document.images || []);
            const imagesReady = images.every((img) => img.complete && img.naturalWidth > 0);
            const fontsReady = !document.fonts || document.fonts.status === "loaded";
            if (imagesReady && fontsReady) break;
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          return true;
        })()
      `);
    } catch {
      // The document can still be printable if an optional resource failed.
    }

    // silent:true sends the job straight to the printer using the options
    // below (deviceName, copies, pages, etc.) -- all of which the user
    // already chose in MBS's own in-app Print Preview modal. There's no
    // need for a second, OS-native chooser dialog on top of that: with
    // silent:false, webContents.print() opens the Windows native print
    // dialog (title "Mooral Business Suite - Print") as a genuinely
    // separate top-level window so the user can re-pick printer/settings
    // there -- which is exactly the confusing "second window" that kept
    // appearing on top of the app's own preview. Since every setting it
    // would ask for is already collected in-app, silent printing is the
    // correct behavior here: Print really does mean print.
    const printOptions: Electron.WebContentsPrintOptions = {
      silent: true,
      printBackground: settings?.printBackground ?? true,
      landscape: settings?.landscape ?? false,
      color: settings?.color ?? true,
      copies: Math.max(1, settings?.copies ?? 1),
      collate: settings?.collate ?? true
    };

    if (settings?.deviceName) printOptions.deviceName = settings.deviceName;
    if (settings?.duplexMode) printOptions.duplexMode = settings.duplexMode;
    if (settings?.pageSize) printOptions.pageSize = settings.pageSize;
    if (typeof settings?.scaleFactor === "number" && settings.scaleFactor > 0) {
      printOptions.scaleFactor = settings.scaleFactor;
    }

    if (settings?.pages === "current" && typeof settings.currentPage === "number") {
      const page = Math.max(0, Math.floor(settings.currentPage) - 1);
      printOptions.pageRanges = [{ from: page, to: page }];
    } else if (settings?.pages === "custom" && settings.pageRangeText) {
      const parsed = parsePageRanges(settings.pageRangeText, 9999);
      if (parsed) printOptions.pageRanges = parsed;
    }

    return new Promise<{ success: boolean; error?: string }>((resolve) => {
      let finished = false;
      const finish = (success: boolean, error?: string) => {
        if (finished) return;
        finished = true;
        resolve({ success, error: success ? undefined : error });
      };

      try {
        win.webContents.print(printOptions, (success, errorType) => {
          // The native print dialog has finished at this point (whether the
          // user printed or cancelled). The hidden target is no longer
          // needed, so always release it. This prevents stale targets from
          // leaking across repeated print operations.
          closeActivePrintPreviewWindow();
          finish(success, success ? undefined : errorType);
        });
      } catch (error) {
        closeActivePrintPreviewWindow();
        finish(false, error instanceof Error ? error.message : String(error));
      }
    });
  }
);



// ===============================
// PERMISSION PROFILE IPC HANDLERS (Phase 2)
// ===============================
//
// Listing, Create, Update, and Delete are all available to both the
// Owner and Administrator, per the User Management spec's explicit
// Administrator capability list ("view permissions, create permission
// profiles, edit permission profiles, assign/change permissions,
// manage non-Owner users"). Administrators are not blocked from
// managing the profile templates themselves.

ipcMain.handle(
  "permissionProfiles:list",
  () => {

    if (getActiveSessionUserType() !== "owner" && getActiveSessionUserType() !== "administrator") {
      throw new Error("You do not have access to Permission Profiles.");
    }

    return listPermissionProfiles().map(profile => ({
      ...profile,
      permissionKeys: getProfilePermissionKeys(profile.id)
    }));

  }
);



ipcMain.handle(
  "permissionProfiles:create",
  (_event, data) => {

    if (getActiveSessionUserType() !== "owner" && getActiveSessionUserType() !== "administrator") {
      throw new Error("Only the Owner or an Administrator can create permission profiles.");
    }

    if (!data || typeof data.name !== "string" || !Array.isArray(data.permissionKeys)) {
      throw new Error("A name and permission list are required.");
    }

    const created = createPermissionProfile(data.name, data.description ?? "", data.permissionKeys);

    logAudit("permissions", "create", (created as { id?: number })?.id, data.name, null, { name: data.name, permissionKeys: data.permissionKeys });

    return created;

  }
);



ipcMain.handle(
  "permissionProfiles:update",
  (_event, data) => {

    if (getActiveSessionUserType() !== "owner" && getActiveSessionUserType() !== "administrator") {
      throw new Error("Only the Owner or an Administrator can edit permission profiles.");
    }

    if (!data || typeof data.id !== "number" || typeof data.name !== "string" || !Array.isArray(data.permissionKeys)) {
      throw new Error("A profile id, name, and permission list are required.");
    }

    const updated = updatePermissionProfile(data.id, data.name, data.description ?? "", data.permissionKeys);

    logAudit("permissions", "edit", data.id, data.name, null, { name: data.name, permissionKeys: data.permissionKeys });

    return updated;

  }
);



ipcMain.handle(
  "permissionProfiles:delete",
  (_event, id) => {

    if (getActiveSessionUserType() !== "owner" && getActiveSessionUserType() !== "administrator") {
      throw new Error("Only the Owner or an Administrator can delete permission profiles.");
    }

    if (typeof id !== "number") {
      throw new Error("A profile id is required.");
    }

    deletePermissionProfile(id);

    logAudit("permissions", "delete", id, "Permission profile deleted", null, null);

    return { success: true };

  }
);



// ===============================
// AUDIT LOG IPC HANDLERS (Phase 7)
// ===============================
//
// Owner/Administrator only -- audit data can reveal other users'
// actions and historical values (old_value/new_value snapshots),
// which is sensitive regardless of which module the entry is about.

ipcMain.handle(
  "auditLog:list",
  (_event, filter: AuditLogFilter = {}) => {

    if (getActiveSessionUserType() !== "owner" && getActiveSessionUserType() !== "administrator") {
      throw new Error("You do not have access to the Audit Log.");
    }

    return listAuditLogs(filter);

  }
);



ipcMain.handle(
  "auditLog:export",
  (_event, filter: AuditLogFilter = {}) => {

    if (getActiveSessionUserType() !== "owner" && getActiveSessionUserType() !== "administrator") {
      throw new Error("You do not have access to the Audit Log.");
    }

    // No hard limit for exports -- filtering (module/user/date range)
    // is how the person narrows a large history down, not a cap that
    // silently truncates what they asked to export.
    return listAuditLogs(filter, 100000);

  }
);



// ===============================
// PRODUCT IPC HANDLERS
// ===============================


ipcMain.handle(
  "products:get",
  () => {

    requirePermission("products.view");

    return getProducts();

  }
);



ipcMain.handle(
  "products:create",
  (_event, product) => {

    requirePermission("products.create");

    if (!product || typeof product.name !== "string" || !product.name.trim()) {
      throw new Error("Product name is required.");
    }

    if (product.price !== undefined && (typeof product.price !== "number" || Number.isNaN(product.price) || product.price < 0)) {
      throw new Error("Price must be a non-negative number.");
    }

    if (product.stock !== undefined && (typeof product.stock !== "number" || Number.isNaN(product.stock) || product.stock < 0)) {
      throw new Error("Stock must be a non-negative number.");
    }

    const created = createProduct(product);

    logAudit("products", "create", product.product_id, product.name, null, product);

    return created;

  }
);



ipcMain.handle(
  "products:update",
  (_event, data) => {

    requirePermission("products.edit");

    if (!data || typeof data.id !== "number") {
      throw new Error("A valid product id is required.");
    }

    if (!data.product || typeof data.product.name !== "string" || !data.product.name.trim()) {
      throw new Error("Product name is required.");
    }

    if (data.product.price !== undefined && (typeof data.product.price !== "number" || Number.isNaN(data.product.price) || data.product.price < 0)) {
      throw new Error("Price must be a non-negative number.");
    }

    if (data.product.stock !== undefined && (typeof data.product.stock !== "number" || Number.isNaN(data.product.stock) || data.product.stock < 0)) {
      throw new Error("Stock must be a non-negative number.");
    }

    const updated = updateProduct(
      data.id,
      data.product
    );

    logAudit("products", "edit", data.id, data.product.name, null, data.product);

    createNotification({
      module: "Product",
      action: "Updated",
      message: "Product Updated",
      after: JSON.stringify(data.product)
    });

    return updated;

  }
);



ipcMain.handle(
  "products:delete",
  (_event, id:number) => {

    requirePermission("products.delete");

    const existing = getProducts().find(p => p.id === id) ?? null;

    const result = deleteProduct(id);

    logAudit("products", "delete", id, existing?.name, existing, null);

    return result;

  }
);







// ===============================
// CUSTOMER IPC HANDLERS
// ===============================


ipcMain.handle(
  "customers:get",
  () => {

    requirePermission("customers.view");

    return getCustomers();

  }
);



ipcMain.handle(
  "customers:create",
  (_event, customer) => {

    requirePermission("customers.create");

    if (!customer || typeof customer.name !== "string" || !customer.name.trim()) {
      throw new Error("Customer name is required.");
    }

    const created = createCustomer(customer);

    logAudit("customers", "create", (created as { customer_id?: string })?.customer_id, customer.name, null, customer);

    createNotification({
      module: "Customer",
      action: "Created",
      message: "Customer Created",
      after: JSON.stringify(customer)
    });

    return created;

  }
);



ipcMain.handle(
  "customers:update",
  (_event, data) => {

    requirePermission("customers.edit");

    if (!data || typeof data.id !== "number") {
      throw new Error("A valid customer id is required.");
    }

    if (!data.customer || typeof data.customer.name !== "string" || !data.customer.name.trim()) {
      throw new Error("Customer name is required.");
    }

    const updated = updateCustomer(
      data.id,
      data.customer
    );

    logAudit("customers", "edit", data.id, data.customer.name, null, data.customer);

    return updated;

  }
);



ipcMain.handle(
  "customers:delete",
  (_event, id:number) => {

    requirePermission("customers.delete");

    const existing = getCustomers().find(c => c.id === id) ?? null;

    const result = deleteCustomer(id);

    logAudit("customers", "delete", id, existing?.name, existing, null);

    return result;

  }
);







// ===============================
// ORDER IPC HANDLERS
// ===============================


ipcMain.handle(
  "orders:get",
  (
    _event,
    filters?: {
      fromDate?: string;
      toDate?: string;
    }
  ) => {

    requirePermission("orders.view");

    return getOrders(
      filters?.fromDate,
      filters?.toDate
    );

  }
);



ipcMain.handle(
  "orders:create",
  (_event, order) => {

    requirePermission("orders.create");

    if (!order || typeof order.customer_name !== "string" || !order.customer_name.trim()) {
      throw new Error("Customer is required.");
    }

    const items = Array.isArray(order.items) && order.items.length
      ? order.items
      : [order];

    for (const item of items) {
      if (typeof item.product_name !== "string" || !item.product_name.trim()) {
        throw new Error("Product is required.");
      }
      if (typeof item.quantity !== "number" || !Number.isFinite(item.quantity) || item.quantity <= 0) {
        throw new Error("Quantity must be a positive number.");
      }
    }

    const created = createOrder({ ...order, items });

    logAudit("orders", "create", created?.order_id, order.customer_name, null, { ...order, items });

    return created;

  }
);



ipcMain.handle(
  "orders:update",
  (_event, data) => {

    requirePermission("orders.edit");

    if (!data || typeof data.id !== "number") {
      throw new Error("A valid order id is required.");
    }

    if (!data.order || typeof data.order.customer_name !== "string" || !data.order.customer_name.trim()) {
      throw new Error("Customer is required.");
    }

    // An order can carry multiple products, so validate every line item
    // in `items` (falling back to treating `data.order` itself as a
    // single line item for backward compatibility), the same way
    // "orders:create" already does -- not just one product/quantity pair.
    const items = Array.isArray(data.order.items) && data.order.items.length
      ? data.order.items
      : [data.order];

    if (!items.length) {
      throw new Error("At least one product is required.");
    }

    for (const item of items) {
      if (typeof item.product_name !== "string" || !item.product_name.trim()) {
        throw new Error("Product is required.");
      }
      if (typeof item.quantity !== "number" || !Number.isFinite(item.quantity) || item.quantity <= 0) {
        throw new Error("Quantity must be a positive number.");
      }
    }

    const updated = updateOrder(
      data.id,
      { ...data.order, items }
    );

    logAudit("orders", "edit", data.order?.order_id ?? data.id, data.order.customer_name, null, { ...data.order, items });

    return updated;

  }
);



ipcMain.handle(
  "orders:delete",
  (_event, id:number) => {

    requirePermission("orders.delete");

    const existing = getOrders().find(o => o.id === id) ?? null;

    const result = deleteOrder(id);

    logAudit("orders", "delete", existing?.order_id ?? id, existing?.customer_name, existing, null);

    return result;

  }
);





// ===============================
// INVENTORY IPC HANDLERS
// ===============================


ipcMain.handle(
  "inventory:get",
  (
    _event,
    filters?: {
      fromDate?: string;
      toDate?: string;
    }
  ) => {

    // Inventory has no separate entry in the permission catalog -- it
    // is gated under "products" throughout the app (see routes.tsx's
    // /inventory route, which already uses module="products").
    requirePermission("products.view");

    return getInventoryTransactions(
      filters?.fromDate,
      filters?.toDate
    );

  }
);



ipcMain.handle(
  "inventory:stockIn",
  (_event, data) => {

    requirePermission("inventory.edit");

    if (!data || typeof data.product_id !== "string" || !data.product_id) {
      throw new Error("A valid product is required.");
    }

    if (typeof data.quantity !== "number" || !Number.isFinite(data.quantity) || data.quantity <= 0) {
      throw new Error("Quantity must be a positive number.");
    }

    const result = stockIn(

      data.product_id,

      data.quantity,

      data.note

    );

    logAudit("inventory", "adjust", data.product_id, `Stock In: +${data.quantity}`, null, {
      product_id: data.product_id,
      quantity: data.quantity,
      note: data.note ?? null
    });

    return result;

  }
);



ipcMain.handle(
  "inventory:stockOut",
  (_event, data) => {

    requirePermission("inventory.edit");

    if (!data || typeof data.product_id !== "string" || !data.product_id) {
      throw new Error("A valid product is required.");
    }

    if (typeof data.quantity !== "number" || !Number.isFinite(data.quantity) || data.quantity <= 0) {
      throw new Error("Quantity must be a positive number.");
    }

    const result = stockOut(

      data.product_id,

      data.quantity,

      data.note

    );

    logAudit("inventory", "adjust", data.product_id, `Stock Out: -${data.quantity}`, null, {
      product_id: data.product_id,
      quantity: data.quantity,
      note: data.note ?? null
    });

    return result;

  }
);


// ===============================
// INVOICE IPC HANDLERS
// ===============================


ipcMain.handle(
  "invoices:get",
  (_event, filters?: {
    search?: string;
    status?: string;
    fromDate?: string;
    toDate?: string;
  }) => {

    requirePermission("invoices.view");

    return getInvoices(filters);

  }
);



ipcMain.handle(
  "invoices:getById",
  (_event, id: number) => {

    requirePermission("invoices.view");

    return getInvoiceById(id);

  }
);



ipcMain.handle(
  "invoices:summary",
  () => {

    requirePermission("invoices.view");

    return getInvoiceSummary();

  }
);



ipcMain.handle(
  "invoices:update",
  (_event, data) => {

    requirePermission("invoices.edit");

    if (!data || typeof data.id !== "number") {
      throw new Error("A valid invoice id is required.");
    }

    if (!data.invoice || typeof data.invoice.customer_name !== "string" || !data.invoice.customer_name.trim()) {
      throw new Error("Customer is required.");
    }

    if (!Array.isArray(data.invoice.items) || data.invoice.items.length === 0) {
      throw new Error("At least one invoice item is required.");
    }

    return updateInvoice(
      data.id,
      data.invoice
    );

  }
);



ipcMain.handle(
  "invoices:delete",
  (_event, id: number) => {

    requirePermission("invoices.delete");

    return deleteInvoice(id);

  }
);



// Repeating invoice footer for the exported PDF, rendered by Chromium
// in its own per-page layer (see pdf-engine.ts's footerTemplateHtml
// handling). Visual design intentionally mirrors the in-flow ".footer"
// block in invoices-page.tsx's buildInvoiceHtml() exactly (same text,
// border, color, font-size) -- only the positioning mechanism differs,
// since that in-flow version cannot reliably repeat per PDF page (see
// the investigation notes next to buildInvoiceHtml).
const INVOICE_PDF_FOOTER_TEMPLATE = `
  <div style="width:100%;box-sizing:border-box;margin:0 6mm;padding-top:3.6mm;border-top:.35mm solid #e4e7ec;text-align:center;color:#a8b2c3;font-size:6.8pt;font-family:Arial,Helvetica,sans-serif;">
    This document is automatically system generated.
  </div>
`;

ipcMain.handle(
  "invoices:exportPdf",
  async (_event, data: { html: string; fileName: string }) => {
    requirePermission("invoices.view");

    return renderPdf({
      html: data.html,
      fileName: data.fileName,
      dialogTitle: "Export Invoice as PDF",
      pageSize: "A4",
      footerTemplateHtml: INVOICE_PDF_FOOTER_TEMPLATE,
      // 12mm: verified by actually rendering 1-, 40- and 45-item test
      // invoices through real Chromium and inspecting every resulting
      // page -- large enough to fit the footer with clearance, small
      // enough not to push extra near-blank pages onto documents whose
      // content would otherwise land right at a page boundary.
      footerMarginMm: 12
    });
  }
);


// ===============================
// CERTIFICATE IPC HANDLERS
// ===============================


ipcMain.handle(
  "certificates:get",
  (_event, filters?: {
    search?: string;
    status?: string;
    fromDate?: string;
    toDate?: string;
  }) => {

    requirePermission("certificates.view");

    return getCertificates(filters);

  }
);



ipcMain.handle(
  "certificates:getById",
  (_event, id: number) => {

    requirePermission("certificates.view");

    return getCertificateById(id);

  }
);



ipcMain.handle(
  "certificates:summary",
  () => {

    requirePermission("certificates.view");

    return getCertificateSummary();

  }
);



function validateCertificatePayload(certificate: any) {

  if (!certificate || (certificate.certificate_category !== "Employee" && certificate.certificate_category !== "Product")) {
    throw new Error("Certificate category must be Employee or Product.");
  }

  if (typeof certificate.certificate_type !== "string" || !certificate.certificate_type.trim()) {
    throw new Error("Certificate type is required.");
  }

  if (typeof certificate.title !== "string" || !certificate.title.trim()) {
    throw new Error("Certificate title is required.");
  }

  if (certificate.certificate_category === "Employee") {

    // Task 9: Employee data must come from the Employee database via
    // a dropdown selection, not manual typing -- require employee_id
    // (the selected employee's employee_number) in addition to the
    // auto-populated employee_name, so an empty selection can never
    // be saved even if a caller bypasses the renderer-side check.
    if (typeof certificate.employee_id !== "string" || !certificate.employee_id.trim()) {
      throw new Error("Please select an employee.");
    }

    if (typeof certificate.employee_name !== "string" || !certificate.employee_name.trim()) {
      throw new Error("Employee name is required.");
    }

  } else {

    if (typeof certificate.customer_name !== "string" || !certificate.customer_name.trim()) {
      throw new Error("Customer is required.");
    }

    // Task 9: Product data must come from the Product database via a
    // dropdown selection -- require product_id explicitly.
    if (typeof certificate.product_id !== "string" || !certificate.product_id.trim()) {
      throw new Error("Please select a product.");
    }

    if (typeof certificate.product_name !== "string" || !certificate.product_name.trim()) {
      throw new Error("Product is required.");
    }

  }

  if (certificate.issue_date && Number.isNaN(new Date(certificate.issue_date).getTime())) {
    throw new Error("Issue date is invalid.");
  }

  if (certificate.expiry_date && Number.isNaN(new Date(certificate.expiry_date).getTime())) {
    throw new Error("Expiry date is invalid.");
  }

  if (
    certificate.issue_date &&
    certificate.expiry_date &&
    new Date(certificate.expiry_date).getTime() < new Date(certificate.issue_date).getTime()
  ) {
    throw new Error("Expiry date cannot be earlier than the issue date.");
  }

}

ipcMain.handle(
  "certificates:create",
  (_event, certificate) => {

    requirePermission("certificates.create");

    validateCertificatePayload(certificate);

    const created = createCertificate(certificate);

    logAudit("certificates", "create", (created as { certificate_id?: string })?.certificate_id, certificate.certificate_id ?? certificate.product_name, null, certificate);

    createNotification({
      module: "Certificate",
      action: "Issued",
      message: "Certificate Issued",
      after: JSON.stringify(certificate)
    });

    return created;

  }
);



ipcMain.handle(
  "certificates:update",
  (_event, data) => {

    requirePermission("certificates.edit");

    if (!data || typeof data.id !== "number") {
      throw new Error("A valid certificate id is required.");
    }

    const existing = getCertificateById(data.id);

    if (!existing) {
      throw new Error("Certificate not found.");
    }

    validateCertificatePayload({
      ...data.certificate,
      certificate_category: existing.certificate_category
    });

    const updated = updateCertificate(
      data.id,
      data.certificate
    );

    logAudit("certificates", "edit", existing.certificate_id ?? data.id, existing.certificate_id, existing, data.certificate);

    return updated;

  }
);



ipcMain.handle(
  "certificates:delete",
  (_event, id: number) => {

    requirePermission("certificates.delete");

    const existing = getCertificateById(id);

    const result = deleteCertificate(id);

    logAudit("certificates", "delete", existing?.certificate_id ?? id, existing?.certificate_id, existing, null);

    return result;

  }
);



ipcMain.handle(
  "certificates:markPrinted",
  (_event, id: number) => {

    requirePermission("certificates.edit");

    if (typeof id !== "number") {
      throw new Error("A valid certificate id is required.");
    }

    return markCertificatePrinted(id);

  }
);



ipcMain.handle(
  "certificates:exportPdf",
  async (_event, data: { html: string; fileName: string }) => {
    requirePermission("certificates.view");

    return renderPdf({
      html: data.html,
      fileName: data.fileName,
      dialogTitle: "Export Certificate as PDF",
      pageSize: "A4"
    });
  }
);


// ===============================
// EMPLOYEE IPC HANDLERS
// ===============================


ipcMain.handle(
  "employees:get",
  (_event, filters?: {
    search?: string;
    department?: string;
    status?: string;
  }) => {

    requirePermission("employees.view");

    return getEmployees(filters);

  }
);



ipcMain.handle(
  "employees:getById",
  (_event, id: number) => {

    requirePermission("employees.view");

    return getEmployeeById(id);

  }
);



const PHONE_PATTERN = /^[0-9+\-\s()]{6,20}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateEmployeePayload(employee: any) {

  if (!employee || typeof employee.first_name !== "string" || !employee.first_name.trim()) {
    throw new Error("First name is required.");
  }

  if (typeof employee.last_name !== "string" || !employee.last_name.trim()) {
    throw new Error("Last name is required.");
  }

  if (typeof employee.phone !== "string" || !employee.phone.trim()) {
    throw new Error("Phone number is required.");
  }

  if (!PHONE_PATTERN.test(employee.phone.trim())) {
    throw new Error("Phone number is invalid.");
  }

  if (employee.email && !EMAIL_PATTERN.test(employee.email.trim())) {
    throw new Error("Email address is invalid.");
  }

  if (!EMPLOYEE_DEPARTMENTS.includes(employee.department)) {
    throw new Error("A valid Department must be selected.");
  }

  if (!EMPLOYEE_DESIGNATIONS.includes(employee.designation)) {
    throw new Error("A valid Designation must be selected.");
  }

  if (employee.employment_status && !EMPLOYEE_STATUS_OPTIONS.includes(employee.employment_status)) {
    throw new Error("Invalid Employment Status.");
  }

  if (employee.employment_type && !EMPLOYMENT_TYPE_OPTIONS.includes(employee.employment_type)) {
    throw new Error("Invalid Employment Type.");
  }

  if (employee.identity_type && !IDENTITY_TYPE_OPTIONS.includes(employee.identity_type)) {
    throw new Error("Invalid Identity Type.");
  }

  if (employee.resignation_date && Number.isNaN(new Date(employee.resignation_date).getTime())) {
    throw new Error("Resignation Date is invalid.");
  }

  if (employee.contract_start_date && Number.isNaN(new Date(employee.contract_start_date).getTime())) {
    throw new Error("Contract Start Date is invalid.");
  }

  if (employee.contract_end_date && Number.isNaN(new Date(employee.contract_end_date).getTime())) {
    throw new Error("Contract End Date is invalid.");
  }

  if (
    employee.contract_start_date &&
    employee.contract_end_date &&
    new Date(employee.contract_end_date).getTime() < new Date(employee.contract_start_date).getTime()
  ) {
    throw new Error("Contract End Date cannot be before Contract Start Date.");
  }

  if (
    employee.salary !== undefined &&
    employee.salary !== null &&
    employee.salary !== "" &&
    (typeof employee.salary !== "number" || Number.isNaN(employee.salary) || employee.salary < 0)
  ) {
    throw new Error("Salary must be a non-negative number.");
  }

  if (employee.date_of_birth) {

    const dob = new Date(employee.date_of_birth);

    if (Number.isNaN(dob.getTime())) {
      throw new Error("Date of Birth is invalid.");
    }

    if (dob.getTime() > Date.now()) {
      throw new Error("Date of Birth cannot be in the future.");
    }

  }

  if (employee.joining_date && Number.isNaN(new Date(employee.joining_date).getTime())) {
    throw new Error("Joining Date is invalid.");
  }

  if (
    employee.emergency_contact_phone &&
    !PHONE_PATTERN.test(String(employee.emergency_contact_phone).trim())
  ) {
    throw new Error("Emergency contact phone number is invalid.");
  }

}

ipcMain.handle(
  "employees:create",
  (_event, employee) => {

    requirePermission("employees.create");

    validateEmployeePayload(employee);

    const { photo_data_url, ...rest } = employee;

    const created = createEmployee(rest);

    if (photo_data_url) {

      const decoded = decodePhotoDataUrl(photo_data_url);

      if (decoded) {
        saveEmployeePhoto(created.id, decoded.buffer, decoded.mime);
      }

    }

    createNotification({
      module: "Employee",
      action: "Created",
      message: "Employee Created",
      after: JSON.stringify(rest)
    });

    logAudit("employees", "create", created.id, rest.full_name ?? rest.name, null, rest);

    return created;

  }
);



ipcMain.handle(
  "employees:update",
  (_event, data) => {

    requirePermission("employees.edit");

    if (!data || typeof data.id !== "number") {
      throw new Error("A valid employee id is required.");
    }

    validateEmployeePayload(data.employee);

    const { photo_data_url, remove_photo, ...rest } = data.employee ?? {};

    const result = updateEmployee(data.id, rest);

    if (photo_data_url) {

      const decoded = decodePhotoDataUrl(photo_data_url);

      if (decoded) {
        saveEmployeePhoto(data.id, decoded.buffer, decoded.mime);
      }

    }
    else if (remove_photo) {

      removeEmployeePhoto(data.id);

    }

    createNotification({
      module: "Employee",
      action: "Updated",
      message: "Employee Updated",
      after: JSON.stringify(rest)
    });

    logAudit("employees", "edit", data.id, rest.full_name ?? rest.name, null, rest);

    return result;

  }
);



ipcMain.handle(
  "employees:delete",
  (_event, id: number) => {

    requirePermission("employees.delete");

    const existing = getEmployeeById(id);

    const result = deleteEmployee(id);

    logAudit("employees", "delete", id, existing?.full_name ?? existing?.name, existing, null);

    return result;

  }
);



ipcMain.handle(
  "employees:pickPhoto",
  async () => {

    // Reached from both the Add Employee and Edit Employee forms, so
    // either permission is enough to pick a photo file -- the actual
    // create/update is separately enforced by employees:create /
    // employees:update above.
    try {
      requirePermission("employees.create");
    }
    catch {
      requirePermission("employees.edit");
    }

    return pickEmployeePhoto(mainWindow);

  }
);



ipcMain.handle(
  "employees:getPhotoPreview",
  (_event, id: number) => {

    requirePermission("employees.view");

    return getEmployeePhotoDataUrl(id);

  }
);



// ===============================
// EMPLOYEE CONTRACT IPC HANDLERS
// ===============================


ipcMain.handle(
  "employeeContracts:getByEmployee",
  (_event, employeeId: number) => {

    requirePermission("employees.view");

    return getContractsByEmployee(employeeId);

  }
);



ipcMain.handle(
  "employeeContracts:getCurrent",
  (_event, employeeId: number) => {

    requirePermission("employees.view");

    return getCurrentContract(employeeId);

  }
);



function validateContractDates(startDate: string, endDate?: string | null) {

  if (!startDate || Number.isNaN(new Date(startDate).getTime())) {
    throw new Error("A valid Contract Start Date is required.");
  }

  if (endDate && Number.isNaN(new Date(endDate).getTime())) {
    throw new Error("Contract End Date is invalid.");
  }

  if (endDate && new Date(endDate).getTime() < new Date(startDate).getTime()) {
    throw new Error("Contract End Date cannot be before Contract Start Date.");
  }

}

ipcMain.handle(
  "employeeContracts:create",
  (_event, data: {
    employee_id: number;
    contract_start_date: string;
    contract_end_date?: string | null;
  }) => {

    requirePermission("employees.edit");

    if (!data || typeof data.employee_id !== "number") {
      throw new Error("A valid employee id is required.");
    }

    validateContractDates(data.contract_start_date, data.contract_end_date);

    return createContract(data);

  }
);



ipcMain.handle(
  "employeeContracts:extend",
  (_event, data: {
    contract_id: number;
    contract_end_date: string;
    extension_reason: string;
  }) => {

    requirePermission("employees.edit");

    if (!data || typeof data.contract_id !== "number") {
      throw new Error("A valid contract id is required.");
    }

    if (!data.contract_end_date || Number.isNaN(new Date(data.contract_end_date).getTime())) {
      throw new Error("A valid new Contract End Date is required.");
    }

    if (!data.extension_reason || !data.extension_reason.trim()) {
      throw new Error("An extension reason is required.");
    }

    return extendContract(data);

  }
);



// ===============================
// ACCOUNTING IPC HANDLERS
// ===============================

ipcMain.handle(
  "accounting:get",
  (
    _event,
    filters?: {
      fromDate?: string;
      toDate?: string;
    }
  ) => {

    requirePermission("accounting.view");

    if (filters?.fromDate || filters?.toDate) {
      return getTransactionsByDate(filters.fromDate, filters.toDate);
    }

    return getTransactions();
  }
);

ipcMain.handle(
  "accounting:summary",
  (
    _event,
    filters?: {
      fromDate?: string;
      toDate?: string;
    }
  ) => {
    requirePermission("accounting.view");

    return getTransactionSummary(filters?.fromDate, filters?.toDate);
  }
);

ipcMain.handle(
  "accounting:create",
  (_event, transaction) => {

    requirePermission("accounting.create");

    if (!transaction || (transaction.type !== "Income" && transaction.type !== "Expense")) {
      throw new Error("Transaction type must be Income or Expense.");
    }

    if (typeof transaction.category !== "string" || !transaction.category.trim()) {
      throw new Error("Category is required.");
    }

    if (typeof transaction.description !== "string" || !transaction.description.trim()) {
      throw new Error("Description is required.");
    }

    if (typeof transaction.amount !== "number" || !Number.isFinite(transaction.amount) || transaction.amount <= 0) {
      throw new Error("Amount must be a positive number.");
    }

    return createTransaction(transaction);
  }
);

ipcMain.handle(
  "accounting:update",
  (_event, data) => {

    requirePermission("accounting.edit");

    if (!data || typeof data.id !== "number") {
      throw new Error("A valid transaction id is required.");
    }

    if (!data.transaction || (data.transaction.type !== "Income" && data.transaction.type !== "Expense")) {
      throw new Error("Transaction type must be Income or Expense.");
    }

    if (typeof data.transaction.category !== "string" || !data.transaction.category.trim()) {
      throw new Error("Category is required.");
    }

    if (typeof data.transaction.description !== "string" || !data.transaction.description.trim()) {
      throw new Error("Description is required.");
    }

    if (typeof data.transaction.amount !== "number" || !Number.isFinite(data.transaction.amount) || data.transaction.amount <= 0) {
      throw new Error("Amount must be a positive number.");
    }

    // Invoice-generated transactions are protected: their Type, Category,
    // and Reference No. are locked to keep the invoice <-> transaction
    // link intact. Editing these must happen from the invoice instead.
    const existingTransaction = getTransactionById(data.id) as
      | { type: string; category: string; reference_no: string | null; source_invoice_id: string | null }
      | undefined;

    if (existingTransaction?.source_invoice_id) {

      if (data.transaction.type !== existingTransaction.type) {
        throw new Error("This transaction is automatically generated from an invoice. Edit the invoice instead.");
      }

      if (data.transaction.category !== existingTransaction.category) {
        throw new Error("This transaction is automatically generated from an invoice. Edit the invoice instead.");
      }

      if ((data.transaction.reference_no ?? "") !== (existingTransaction.reference_no ?? "")) {
        throw new Error("This transaction is automatically generated from an invoice. Edit the invoice instead.");
      }

    }

    return updateTransaction(
      data.id,
      data.transaction
    );
  }
);

ipcMain.handle(
  "accounting:delete",
  (_event, id: number) => {

    requirePermission("accounting.delete");

    // Invoice-generated transactions cannot be deleted directly; they are
    // managed by the invoice that created them.
    const existingTransaction = getTransactionById(id) as
      | { source_invoice_id: string | null; transaction_id?: string }
      | undefined;

    if (existingTransaction?.source_invoice_id) {
      throw new Error("This transaction is automatically generated from an invoice. Edit the invoice instead.");
    }

    const result = deleteTransaction(id);

    createNotification({
      module: "Accounting",
      action: "Deleted",
      message: "Transaction Deleted",
      before: existingTransaction?.transaction_id ?? String(id)
    });

    return result;
  }
);



// ===============================
// LEDGER / JOURNAL IPC HANDLERS
// ===============================
// Reuses the existing "accounting" permission module (view/create) --
// the ledger and journal are part of the Accounting page, not a
// separate module, so no new permission keys were added.

ipcMain.handle(
  "ledger:accounts",
  () => {
    requirePermission("accounting.view");
    return getAccounts();
  }
);

ipcMain.handle(
  "ledger:accountSummary",
  () => {
    requirePermission("accounting.view");
    return getAccountSummary();
  }
);

ipcMain.handle(
  "ledger:customerLedger",
  (
    _event,
    filters: {
      customerId: string;
      fromDate?: string;
      toDate?: string;
    }
  ) => {
    requirePermission("accounting.view");

    if (!filters?.customerId) {
      throw new Error("A customer is required.");
    }

    return getCustomerLedger(filters.customerId, filters.fromDate, filters.toDate);
  }
);

ipcMain.handle(
  "ledger:customersWithActivity",
  () => {
    requirePermission("accounting.view");
    return getCustomersWithLedgerActivity();
  }
);

ipcMain.handle(
  "ledger:generalLedger",
  (
    _event,
    filters?: {
      accountId?: number;
      fromDate?: string;
      toDate?: string;
    }
  ) => {
    requirePermission("accounting.view");
    return getGeneralLedger(filters);
  }
);

ipcMain.handle(
  "journal:get",
  (
    _event,
    filters?: {
      fromDate?: string;
      toDate?: string;
    }
  ) => {
    requirePermission("accounting.view");
    return getJournalEntries(filters);
  }
);

ipcMain.handle(
  "journal:create",
  (
    _event,
    data: {
      entry_date: string;
      debit_account_id: number;
      credit_account_id: number;
      amount: number;
      reference?: string;
      description: string;
    }
  ) => {

    requirePermission("accounting.create");

    if (!data) {
      throw new Error("Journal entry data is required.");
    }

    if (typeof data.debit_account_id !== "number" || typeof data.credit_account_id !== "number") {
      throw new Error("A valid debit and credit account is required.");
    }

    if (typeof data.amount !== "number" || !Number.isFinite(data.amount) || data.amount <= 0) {
      throw new Error("Amount must be a positive number.");
    }

    if (typeof data.description !== "string" || !data.description.trim()) {
      throw new Error("Description is required.");
    }

    const journalEntry = createManualJournalEntry(data);

    createNotification({
      module: "Accounting",
      action: "Created",
      message: "Journal Entry Posted",
      after: journalEntry.journal_id
    });

    return journalEntry;
  }
);



// ===============================
// NOTIFICATIONS IPC HANDLERS
// ===============================
//
// Delete/reset are restricted to Owner/Administrator. There is no
// "notifications" module in the permission catalog (notifications
// aren't a business-data module like Products/Orders/etc.), so this
// mirrors the same Owner/Administrator-unrestricted-access rule the
// permission engine already applies everywhere outside that catalog
// (see permission-engine.ts) rather than introducing a one-off
// permission key for a single pair of actions. Previously this only
// checked a `role` value the renderer itself sent along with the
// request -- trivially spoofable, and exactly the kind of
// client-supplied authorization the legacy role system relied on.
// Real authorization now comes from the active session, the same as
// every other handler in this file.

ipcMain.handle(
  "notifications:get",
  () => {
    // SECURITY (IPC audit): no auth check previously, despite the
    // (stale) comment above claiming otherwise -- that comment describes
    // notifications:delete/reset below, not this handler. Any active
    // session, not Owner-only: notifications are a normal, low-privilege
    // everyday feature for every role.
    requireUserType("owner", "administrator", "employee");
    return getNotifications();
  }
);

ipcMain.handle(
  "notifications:create",
  (_event, notification) => {
    // SECURITY (IPC audit): no auth check previously.
    requireUserType("owner", "administrator", "employee");

    if (!notification || typeof notification.message !== "string" || !notification.message.trim()) {
      throw new Error("A notification message is required.");
    }

    return createNotification(notification);
  }
);

ipcMain.handle(
  "notifications:delete",
  (_event, data: { id: number }) => {

    requireUserType("owner", "administrator");

    return deleteNotification(data?.id);
  }
);

ipcMain.handle(
  "notifications:reset",
  () => {

    requireUserType("owner", "administrator");

    return resetNotifications();
  }
);



// ===============================
// INTERNAL MESSAGES IPC HANDLERS
// ===============================
//
// Every handler re-derives the caller from the active session inside
// messaging-manager.ts itself (defense in depth, same convention as
// notifications/password reset above) rather than trusting a userId
// the renderer might supply.

ipcMain.handle(
  "messages:listRecipients",
  () => {
    return listMessageableRecipients();
  }
);

ipcMain.handle(
  "messages:inbox",
  () => {
    return getInbox();
  }
);

ipcMain.handle(
  "messages:sent",
  () => {
    return getSent();
  }
);

ipcMain.handle(
  "messages:unreadCount",
  () => {
    return getUnreadCount();
  }
);

ipcMain.handle(
  "messages:open",
  (_event, data: { id: number }) => {

    if (!data || typeof data.id !== "number") {
      throw new Error("A message id is required.");
    }

    return openMessage(data.id);

  }
);

ipcMain.handle(
  "messages:send",
  (_event, data: { recipientId: number; subject: string; body: string }) => {

    if (!data || typeof data.recipientId !== "number" || typeof data.subject !== "string" || typeof data.body !== "string") {
      throw new Error("Recipient, subject, and message body are required.");
    }

    return sendMessage(data.recipientId, data.subject, data.body);

  }
);

ipcMain.handle(
  "messages:reply",
  (_event, data: { messageId: number; body: string }) => {

    if (!data || typeof data.messageId !== "number" || typeof data.body !== "string") {
      throw new Error("A message id and reply body are required.");
    }

    return replyToMessage(data.messageId, data.body);

  }
);

ipcMain.handle(
  "messages:edit",
  (_event, data: { messageId: number; subject: string; body: string }) => {

    if (!data || typeof data.messageId !== "number" || typeof data.subject !== "string" || typeof data.body !== "string") {
      throw new Error("A message id, subject, and body are required.");
    }

    return editMessage(data.messageId, data.subject, data.body);

  }
);

ipcMain.handle(
  "messages:delete",
  (_event, data: { messageId: number }) => {

    if (!data || typeof data.messageId !== "number") {
      throw new Error("A message id is required.");
    }

    return deleteMessage(data.messageId);

  }
);



// ===============================
// SETTINGS IPC HANDLERS
// ===============================

ipcMain.handle(
  "settings:get",
  () => {

    // SECURITY (IPC audit): previously no auth check at all -- reachable
    // pre-login. Company settings include integration_api_key (a real
    // secret -- see the redaction in settings:save's audit-log call
    // below, which already treated it as sensitive without anything ever
    // gating who could read it) plus every other company-wide setting.
    // Kept to "any active session" rather than Owner-only: many ordinary,
    // low-privilege screens legitimately read this for everyday
    // rendering (currency formatting, invoice number previews, etc.), so
    // restricting to Owner would break normal Employee/Administrator use
    // of the app. requireUserType still closes the actual hole (nothing
    // pre-login, nothing from an unauthenticated script).
    requireUserType("owner", "administrator", "employee");

    // Reuses the existing company settings service (defaults + merge
    // behavior live there) instead of duplicating logic here.
    return getCompanySettings();

  }
);



ipcMain.handle(
  "settings:save",
  (_event, settings) => {

    // SECURITY (IPC audit): previously no auth check at all. Unlike the
    // read above, WRITE access is restricted to Owner/Administrator --
    // this can change security-sensitive fields (security_max_login_
    // attempts, security_lockout_minutes, security_session_timeout_
    // minutes) and integration_api_key, so an Employee (let alone an
    // unauthenticated caller) being able to silently weaken account
    // lockout policy or session timeout, or rotate the integration key,
    // is a real privilege-escalation and security-downgrade path, not a
    // theoretical one. Matches how every other company-wide
    // configuration surface in this app (Permission Profiles, User
    // Management, Database Backup/Restore) is already gated.
    requireUserType("owner", "administrator");

    const before = getCompanySettings();

    const result = updateCompanySettings(settings);

    // audit_log stores old_value/new_value as plain JSON (see
    // audit-log-repository.ts) -- logging the API key here in either
    // snapshot would put a plaintext copy of it right back into the
    // database after encryptApiKey() just encrypted it at rest.
    // Redact it the same way a password would be.
    const redact = (value: unknown) => {
      if (!value || typeof value !== "object") return value;
      const clone = { ...(value as Record<string, unknown>) };
      if ("integrationApiKey" in clone) clone.integrationApiKey = "[redacted]";
      return clone;
    };

    logAudit("settings", "edit", "company_settings", "Company settings updated", redact(before), redact(settings));

    createNotification({
      module: "Settings",
      action: "Updated",
      message: "Settings Updated"
    });

    return result;

  }
);

ipcMain.handle(
  "settings:getLogoPreview",
  (_event, legacyPath?: string) => {

    // Database is always the source of truth now; legacyPath is only
    // consulted as a defensive fallback inside getCompanyLogoDataUrl.
    return getCompanyLogoDataUrl(legacyPath);

  }
);

// Deprecated: kept only so any older call sites (or future callers)
// that just need a raw file path continue to work. No longer used by
// the Settings Dashboard, which uses settings:uploadLogo instead.
ipcMain.handle(
  "settings:selectLogo",
  async () => {

    if (!mainWindow) {
      return null;
    }


    const result = await dialog.showOpenDialog(
      mainWindow,
      {
        title: "Select Company Logo",

        properties: [
          "openFile"
        ],

        filters: [
          {
            name: "Images",
            extensions: [
              "png",
              "jpg",
              "jpeg",
              "webp"
            ]
          }
        ]

      }
    );


    if (
      result.canceled ||
      result.filePaths.length === 0
    ){

      return null;

    }


    return result.filePaths[0];

  }
);

ipcMain.handle(
  "settings:uploadLogo",
  async () => {

    if (!mainWindow) {
      return null;
    }

    const result = await dialog.showOpenDialog(
      mainWindow,
      {
        title: "Select Company Logo",

        properties: [
          "openFile"
        ],

        filters: [
          {
            name: "Images",
            extensions: [
              "png",
              "jpg",
              "jpeg",
              "webp"
            ]
          }
        ]

      }
    );

    if (
      result.canceled ||
      result.filePaths.length === 0
    ) {

      return null;

    }

    try {

      const fileBuffer = fs.readFileSync(result.filePaths[0]);
      return saveCompanyLogoFromBuffer(fileBuffer);

    }
    catch (error) {

      console.error("Logo upload failed", error);

      return null;

    }

  }
);

// Saves a logo the user has already reviewed and approved in the renderer
// (see src/utils/logo-image.ts, which fits it to the square logo frame).
// Only a PNG data URL is accepted, the payload is size-capped and the PNG
// signature is checked before it reaches the image pipeline.
ipcMain.handle(
  "settings:saveLogo",
  (_event, dataUrl: unknown) => {

    const prefix = "data:image/png;base64,";

    if (typeof dataUrl !== "string" || !dataUrl.startsWith(prefix)) {
      return null;
    }

    const base64 = dataUrl.slice(prefix.length);

    if (!base64 || base64.length > 8 * 1024 * 1024) {
      return null;
    }

    const fileBuffer = Buffer.from(base64, "base64");
    const PNG_SIGNATURE = "89504e470d0a1a0a";

    if (
      fileBuffer.length < 8 ||
      fileBuffer.subarray(0, 8).toString("hex") !== PNG_SIGNATURE
    ) {
      return null;
    }

    try {

      return saveCompanyLogoFromBuffer(fileBuffer);

    }
    catch (error) {

      console.error("Saving reviewed logo failed", error);

      return null;

    }

  }
);

ipcMain.handle(
  "settings:removeLogo",
  () => {

    return { success: removeCompanyLogo() };

  }
);

// ===============================
// APP INFO IPC HANDLER (About / System Settings)
// ===============================

ipcMain.handle(
  "app:getInfo",
  () => {

    return {
      appName: app.getName(),
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron,
      chromeVersion: process.versions.chrome,
      nodeVersion: process.versions.node,
      platform: process.platform,
      arch: process.arch
    };

  }
);

// ===============================
// APP PREFERENCES IPC HANDLERS (About page — Requirement 31)
// ===============================

ipcMain.handle(
  "appPreferences:get",
  () => {

    return loadAppPreferences();

  }
);

ipcMain.handle(
  "appPreferences:set",
  (_event, data) => {

    if (!data || typeof data.key !== "string") {
      throw new Error("A preference key is required.");
    }

    const allowedKeys = ["automaticUpdateChecks", "launchOnStartup", "crashErrorReporting"];

    if (!allowedKeys.includes(data.key) || typeof data.value !== "boolean") {
      throw new Error("Invalid app preference.");
    }

    return setAppPreference(data.key, data.value);

  }
);

ipcMain.handle(
  "appPreferences:checkForUpdatesNow",
  () => {

    return checkForUpdatesNow();

  }
);

// ===============================
// DATABASE / BACKUP & RESTORE IPC HANDLERS
// ===============================

ipcMain.handle(
  "database:getInfo",
  () => {

    // SECURITY (IPC audit): exposes the local database file path and
    // size pre-login previously; minor (local filesystem info
    // disclosure, not a secret), but no legitimate reason to be
    // pre-auth. Matches database:backup/restore/vacuum's own Owner bar,
    // since it's part of the same Database screen.
    requireUserType("owner");

    return getDatabaseInfo();

  }
);



ipcMain.handle(
  "database:backup",
  async () => {

    requireUserType("owner");

    if (!mainWindow) {
      return { success: false };
    }

    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");

    const { canceled, filePath } = await dialog.showSaveDialog(
      mainWindow,
      {
        title: "Create Database Backup",
        defaultPath: `mooral-backup-${timestamp}.db`,
        filters: [
          { name: "SQLite Database", extensions: ["db"] }
        ]
      }
    );

    if (canceled || !filePath) {
      return { success: false, cancelled: true };
    }

    return createBackup(filePath);

  }
);



ipcMain.handle(
  "database:restore",
  async () => {

    requireUserType("owner");

    if (!mainWindow) {
      return { success: false };
    }

    const { canceled, filePaths } = await dialog.showOpenDialog(
      mainWindow,
      {
        title: "Restore Database From Backup",
        properties: ["openFile"],
        filters: [
          { name: "SQLite Database", extensions: ["db"] }
        ]
      }
    );

    if (canceled || filePaths.length === 0) {
      return { success: false, cancelled: true };
    }

    const result = await restoreFromBackup(filePaths[0]);

    if (result.success) {

      // The live database handle has just been replaced on disk, so
      // every open window's in-memory state (and any cached
      // statements) is now stale. A clean relaunch is the simplest
      // and safest way to guarantee the whole app -- not just this
      // one IPC caller -- picks up the restored data. Delayed slightly
      // so this response reaches the renderer first.
      setTimeout(
        () => {
          app.relaunch();
          app.exit(0);
        },
        500
      );

    }

    return result;

  }
);



ipcMain.handle(
  "database:vacuum",
  () => {

    requireUserType("owner");

    return vacuumDatabase();

  }
);



ipcMain.handle(
  "database:checkIntegrity",
  () => {

    requireUserType("owner");

    return checkDatabaseIntegrity();

  }
);



// ===============================
// LICENSE IPC HANDLERS (v2)
// ===============================
//
// Registered from electron/main/license-v2/ipc.ts. See that module
// and license-manager.ts for the actual verification/activation
// logic. Nothing license-related lives inline in main.ts anymore.
//
// Deliberately passing requireUserTypeAllowUnlicensed here, NOT
// requireUserType -- see the comment at the top of license-v2/ipc.ts
// (audit fix #1) for why the license-management actions themselves
// must stay reachable even when the current license is invalid.

registerLicenseIpcV2(requireUserTypeAllowUnlicensed);



// ===============================
// CREATE WINDOW
// ===============================


// Dedicated square taskbar/window icon. The original MBS.ico contains the
// full horizontal wordmark with large transparent margins, which Windows
// scales into the taskbar slot as a very small-looking icon.
// MBS-taskbar.ico contains the square MBS mark at a much larger effective
// size, while MBS.ico remains the installer/shortcut branding asset.
const appIconPath = path.join(__dirname, "../../MBS-taskbar.ico");

function createWindow(): void {


  ConfigManager.load();



  const state = loadWindowState();




  mainWindow = new BrowserWindow({


    width: state.width,


    height: state.height,


    x: state.x,


    y: state.y,


    minWidth:1300,


    minHeight:700,


    title:"Mooral Business Suite",


    icon: nativeImage.createFromPath(appIconPath),


    show:false,


    // The renderer's default appearance is Graphite Atelier (dark) -- see
    // the inline theme script in index.html -- and it paints #12151a
    // (--background). Matching that here keeps the native window from
    // flashing white for the moment between the window appearing and the
    // first renderer frame. A user who has explicitly picked the light
    // theme sees this tone for that same brief moment instead.
    backgroundColor:"#12151a",


    autoHideMenuBar:true,



    webPreferences:{


      preload:path.join(

        __dirname,

        "../preload/preload.js"

      ),


      contextIsolation:true,


      nodeIntegration:false,


      // Explicit even though Electron 20+ already defaults to sandboxed
      // renderers -- states the security intent in the same place the
      // other webPreferences live, rather than relying on an implicit
      // default that a future Electron major version could change.
      sandbox:true


    }


  });







  if(state.isMaximized){


    mainWindow.maximize();


  }


  // MBS is fully offline-first (see README) -- the renderer should
  // never navigate anywhere except the app's own dev server / packaged
  // index.html. Top-level navigation (will-navigate) is NOT denied by
  // Electron by default, so without this a compromised dependency or
  // unsanitized renderer content could steer the whole window at an
  // arbitrary remote URL.
  const allowedNavigationOrigin = isDev
    ? "http://localhost:5173"
    : `file://${path.join(__dirname, "../renderer/index.html")}`;

  mainWindow.webContents.on("will-navigate", (event, url) => {

    if (!url.startsWith(allowedNavigationOrigin)) {

      event.preventDefault();
      console.warn("Blocked navigation to disallowed URL:", url);

    }

  });




  mainWindow.once(

    "ready-to-show",

    () => mainWindow?.show()

  );







  if(isDev){


    void mainWindow.loadURL(

      "http://localhost:5173"

    );


  }

  else{


    void mainWindow.loadFile(

      path.join(

        __dirname,

        "../renderer/index.html"

      )

    );


  }








  mainWindow.on(

    "close",

    ()=>{


      if(mainWindow){


        saveWindowState(mainWindow);


      }


    }

  );







  mainWindow.on(

    "closed",

    ()=>{


      mainWindow=null;


    }

  );



}









// ===============================
// APP IDENTITY
// ===============================
// ROOT CAUSE of the print dialog (and any other OS shell surface -- taskbar
// grouping, notifications) showing the generic caption "Electron" instead
// of the app's real name: Windows' native print dialog title is not drawn
// from BrowserWindow.title or document.title -- it's drawn from the
// process's registered app identity (AppUserModelID). An Electron app that
// never calls setName()/setAppUserModelId() runs under Electron's own
// default identity, so every OS-owned surface -- including the native
// print dialog opened by webContents.print() -- shows "Electron" (e.g.
// "Electron - Print") regardless of what title the calling BrowserWindow
// has. This must be set before app.whenReady() / any window is created.
app.setName("Mooral Business Suite");
if (process.platform === "win32") {
  // Matches build.appId in package.json so the identity is consistent
  // between this dev/unpackaged run and the electron-builder packaged app.
  app.setAppUserModelId("com.mooral.businesssuite");
}

// ===============================
// APP EVENTS
// ===============================



app.whenReady().then(async ()=>{


  logInfo(

    "Application started"

  );



  // PERFORMANCE / STARTUP: createWindow() must never wait on cloud sync.
  // This used to be `await startCloudSync(); createWindow();` --
  // startCloudSync() awaits a full syncOnce() cycle internally (push+pull
  // across every CORE_TABLE, potentially many sequential HTTP round
  // trips -- see cloud-sync-manager.ts), so the window would not appear
  // AT ALL until that finished. If the cloud is slow or unreachable, this
  // blocks the entire app open indefinitely behind whatever the network
  // stack's timeout happens to be -- exactly the anti-pattern this
  // codebase's own audit history explicitly rules out ("NEVER: await
  // cloud; await sync; await network; createWindow(); before showing the
  // application"). createWindow() itself only does local, synchronous
  // work (config load, window-state load, BrowserWindow construction) --
  // nothing here needs cloud connectivity to show a usable window.
  // startCloudSync() is fire-and-forget: it still runs (and its own
  // internal `await syncOnce()` still completes before the recurring
  // timer starts, so the cadence is unchanged), just not blocking the
  // window. Any error inside it must not crash startup either.
  void startCloudSync().catch((error) => {
    logInfo(`Cloud sync failed to start: ${error instanceof Error ? error.message : String(error)}`);
  });
  createWindow();





  app.on(

    "activate",

    ()=>{


      if(

        BrowserWindow

        .getAllWindows()

        .length===0

      ){


        createWindow();


      }


    }

  );



});








app.on(

  "before-quit",

  () => {
    stopCloudSync();
  }

);


app.on(

  "window-all-closed",

  ()=>{


    if(

      process.platform!=="darwin"

    ){


      app.quit();


    }


  }

);
