import { useEffect, useMemo, useState } from "react";

import {
  Plus,
  ShieldCheck,
  UserX,
  Archive,
  RotateCcw,
  Copy,
  Check,
  X,
  Users as UsersIcon,
  KeyRound,
  Printer,
  FileDown,
  FileClock,
  Download
} from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { useLanguage } from "@/hooks/use-language";

import {
  listUsers,
  listEmployeesAvailableForLogin,
  createAdministrator,
  createEmployeeLogin,
  disableUser,
  archiveUser,
  restoreUser,
  resetUserPassword,
  listPermissionProfiles,
  createPermissionProfile,
  updatePermissionProfile,
  deletePermissionProfile,
  exportCredentialsPdf,
  listPendingPasswordResetRequests,
  listPasswordResetRequestHistory,
  getPasswordResetAuditLog,
  generatePasswordResetCode,
  approveUsernameRecoveryRequest
} from "@/services/auth-service";

import { buildCredentialHtml, type CredentialPrintParams } from "@/utils/credential-print-template";
import { showPrintPreview, buildPrintDocumentLabel } from "@/utils/print-window";

import {
  PERMISSION_MODULES,
  PERMISSION_ACTIONS,
  type PermissionModule,
  type PermissionAction
} from "@/auth/permission-catalog";

import SettingsShell from "./settings-shell";

import "./user-management.css";

// UserWithEmployee, Employee, PermissionProfileWithKeys, CreateUserResult
// are declared globally in src/types/electron.d.ts.

type Tab = "users" | "profiles" | "resetRequests" | "auditLog";

function userTypeLabel(type: string, t: (key: string) => string): string {

  if (type === "owner") return t("settingsUserManagement.owner");
  if (type === "administrator") return t("settingsUserManagement.administrator");

  return t("settingsUserManagement.employee");

}

function statusLabel(status: string): string {

  return status.charAt(0).toUpperCase() + status.slice(1);

}

export default function UserManagementPage(): JSX.Element {

  const { t } = useLanguage();
  const { user: currentUser, businessMode } = useAuth();

  const [tab, setTab] = useState<Tab>("users");

  const [users, setUsers] = useState<UserWithEmployee[]>([]);
  const [profiles, setProfiles] = useState<PermissionProfileWithKeys[]>([]);
  const [eligibleEmployees, setEligibleEmployees] = useState<Employee[]>([]);
  const [resetRequests, setResetRequests] = useState<PasswordResetRequestRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const [showAddEmployeeModal, setShowAddEmployeeModal] = useState(false);
  const [showProfileEditor, setShowProfileEditor] = useState<PermissionProfileWithKeys | null | "new">(null);

  const [credentialContext, setCredentialContext] = useState<CredentialPrintParams | null>(null);
  const [resetCodeContext, setResetCodeContext] = useState<{ username: string; resetCode: string } | null>(null);

  const isOwner = currentUser?.user_type === "owner";
  // Profile create/edit/delete is available to both Owner and
  // Administrator (see main.ts's permissionProfiles:create/update/delete
  // handlers) -- Administrators are not blocked from managing the
  // profile templates themselves, per the User Management spec's
  // Administrator capability list.
  const isOwnerOrAdmin = isOwner || currentUser?.user_type === "administrator";
  const enterpriseEnabled = businessMode === "enterprise";

  async function reloadAll(): Promise<void> {

    setLoading(true);

    try {

      const [userRows, profileRows, employeeRows, resetRequestRows] = await Promise.all([
        listUsers(),
        listPermissionProfiles(),
        listEmployeesAvailableForLogin(),
        listPendingPasswordResetRequests()
      ]);

      setUsers(userRows);
      setProfiles(profileRows);
      setEligibleEmployees(employeeRows);
      setResetRequests(resetRequestRows);

    }
    finally {

      setLoading(false);

    }

  }

  useEffect(() => {

    if (enterpriseEnabled) {
      reloadAll();
    }
    else {
      setLoading(false);
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enterpriseEnabled]);

  function buildAdminCredentialContext(username: string, temporaryPassword: string): CredentialPrintParams {

    return {
      employeeName: null,
      employeeId: null,
      department: null,
      designation: null,
      username,
      temporaryPassword,
      permissionProfileName: null,
      permissionKeys: [],
      issuedBy: currentUser?.username ?? "Owner"
    };

  }

  function buildEmployeeCredentialContext(
    employee: Employee,
    profile: PermissionProfileWithKeys,
    username: string,
    temporaryPassword: string
  ): CredentialPrintParams {

    return {
      employeeName: `${employee.first_name} ${employee.last_name}`,
      employeeId: employee.employee_number,
      department: employee.department,
      designation: employee.designation,
      username,
      temporaryPassword,
      permissionProfileName: profile.name,
      permissionKeys: profile.permissionKeys,
      issuedBy: currentUser?.username ?? "Administrator"
    };

  }

  function buildRowCredentialContext(
    row: UserWithEmployee,
    temporaryPassword: string
  ): CredentialPrintParams {

    const profile = profiles.find(candidate => candidate.name === row.permission_profile_name);

    return {
      employeeName: row.employee_first_name ? `${row.employee_first_name} ${row.employee_last_name}` : null,
      employeeId: row.employee_number,
      department: row.employee_department,
      designation: row.employee_designation,
      username: row.username,
      temporaryPassword,
      permissionProfileName: row.permission_profile_name,
      permissionKeys: profile?.permissionKeys ?? [],
      issuedBy: currentUser?.username ?? "Owner"
    };

  }

  async function handleCreateAdministrator(): Promise<void> {

    const result = await createAdministrator();

    if (result.success && result.user && result.temporaryPassword) {
      setCredentialContext(buildAdminCredentialContext(result.user.username, result.temporaryPassword));
      await reloadAll();
    }
    else {
      alert(result.error ?? t("settingsUserManagement.failedToCreateAdministrator"));
    }

  }

  async function handleLifecycleAction(userId: number, action: "disable" | "archive" | "restore" | "resetPassword"): Promise<void> {

    try {

      if (action === "disable") await disableUser(userId);
      if (action === "archive") await archiveUser(userId);
      if (action === "restore") await restoreUser(userId);

      if (action === "resetPassword") {

        const row = users.find(candidate => candidate.id === userId);

        const result = await resetUserPassword(userId);

        if (result.success && result.user && result.temporaryPassword && row) {
          setCredentialContext(buildRowCredentialContext(row, result.temporaryPassword));
        }
        else if (!result.success) {
          alert(result.error ?? t("settingsUserManagement.failedToResetPassword"));
        }

      }

      await reloadAll();

    }
    catch (error) {

      alert(error instanceof Error ? error.message : t("settingsUserManagement.actionFailed"));

    }

  }

  async function handleChangeProfile(userId: number, permissionProfileId: number): Promise<void> {

    try {

      const result = await window.mooral.users.changePermissionProfile({ userId, permissionProfileId });

      if (!result.success) {
        alert(result.error ?? t("settingsUserManagement.failedToChangeProfile"));
      }

      await reloadAll();

    }
    catch (error) {

      alert(error instanceof Error ? error.message : t("settingsUserManagement.actionFailed"));

    }

  }

  async function handleGenerateResetCode(request: PasswordResetRequestRecord): Promise<void> {

    const result = await generatePasswordResetCode(request.id);

    if (result.success && result.resetCode) {
      setResetCodeContext({ username: request.username, resetCode: result.resetCode });
      await reloadAll();
    }
    else {
      alert(result.error ?? t("settingsUserManagement.failedToGenerateResetCode"));
    }

  }

  async function handleApproveUsernameRequest(request: PasswordResetRequestRecord): Promise<void> {

    const result = await approveUsernameRecoveryRequest(request.id);

    if (result.success) {
      await reloadAll();
    }
    else {
      alert(result.error ?? t("settingsUserManagement.failedToSendUsername"));
    }

  }

  if (!enterpriseEnabled) {

    return (
      <SettingsShell title={t("settingsUserManagement.title")} description={t("settingsUserManagement.descriptionField")}>

        <div className="user-mgmt-upsell">

          <UsersIcon size={32} className="user-mgmt-upsell-icon" />

          <h3>{t("settingsUserManagement.availableInEnterprise")}</h3>

          <p>
            {t("settingsUserManagement.starterModeDescription")}
          </p>

          {isOwner ? (
            <p className="user-mgmt-hint">{t("settingsUserManagement.upgradeToEnterpriseHint")}</p>
          ) : (
            <p className="user-mgmt-hint">{t("settingsUserManagement.ownerOnlyBusinessMode")}</p>
          )}

        </div>

      </SettingsShell>
    );

  }

  return (
    <SettingsShell title={t("settingsUserManagement.title")} description={t("settingsUserManagement.descriptionField")}>

      <div className="user-mgmt-tabs">

        <button
          className={`user-mgmt-tab ${tab === "users" ? "active" : ""}`}
          onClick={() => setTab("users")}
        >
          {t("settingsUserManagement.tabUsers")}
        </button>

        <button
          className={`user-mgmt-tab ${tab === "profiles" ? "active" : ""}`}
          onClick={() => setTab("profiles")}
        >
          {t("settingsUserManagement.tabPermissionProfiles")}
        </button>

        <button
          className={`user-mgmt-tab ${tab === "resetRequests" ? "active" : ""}`}
          onClick={() => setTab("resetRequests")}
        >
          {t("settingsUserManagement.tabPasswordResetRequests")}
          {resetRequests.length > 0 ? (
            <span className="user-mgmt-tab-badge">{resetRequests.length}</span>
          ) : null}
        </button>

        <button
          className={`user-mgmt-tab ${tab === "auditLog" ? "active" : ""}`}
          onClick={() => setTab("auditLog")}
        >
          {t("settingsUserManagement.tabAuditLog")}
        </button>

      </div>

      {tab === "users" ? (

        <UsersTab
          users={users}
          loading={loading}
          isOwner={isOwner}
          profiles={profiles}
          onAddEmployee={() => setShowAddEmployeeModal(true)}
          onAddAdministrator={handleCreateAdministrator}
          onLifecycleAction={handleLifecycleAction}
          onChangeProfile={handleChangeProfile}
        />

      ) : tab === "profiles" ? (

        <ProfilesTab
          profiles={profiles}
          isOwner={isOwnerOrAdmin}
          onCreate={() => setShowProfileEditor("new")}
          onEdit={profile => setShowProfileEditor(profile)}
          onDelete={async id => {

            try {
              await deletePermissionProfile(id);
              await reloadAll();
            }
            catch (error) {
              alert(error instanceof Error ? error.message : t("settingsUserManagement.failedToDeleteProfile"));
            }

          }}
        />

      ) : tab === "resetRequests" ? (

        <ResetRequestsTab
          requests={resetRequests}
          loading={loading}
          onGenerateCode={handleGenerateResetCode}
          onApproveUsername={handleApproveUsernameRequest}
        />

      ) : (

        <AuditLogTab />

      )}

      {showAddEmployeeModal ? (

        <AddEmployeeLoginModal
          employees={eligibleEmployees}
          profiles={profiles}
          onClose={() => setShowAddEmployeeModal(false)}
          onCreated={async (result, employee, profile) => {

            setShowAddEmployeeModal(false);

            if (result.success && result.user && result.temporaryPassword) {
              setCredentialContext(buildEmployeeCredentialContext(employee, profile, result.user.username, result.temporaryPassword));
              await reloadAll();
            }
            else {
              alert(result.error ?? t("settingsUserManagement.failedToCreateLogin"));
            }

          }}
        />

      ) : null}

      {showProfileEditor ? (

        <ProfileEditorModal
          profile={showProfileEditor === "new" ? null : showProfileEditor}
          onClose={() => setShowProfileEditor(null)}
          onSaved={async () => {

            setShowProfileEditor(null);
            await reloadAll();

          }}
        />

      ) : null}

      {credentialContext ? (

        <CredentialsModal
          credential={credentialContext}
          onClose={() => setCredentialContext(null)}
        />

      ) : null}

      {resetCodeContext ? (

        <ResetCodeModal
          username={resetCodeContext.username}
          resetCode={resetCodeContext.resetCode}
          onClose={() => setResetCodeContext(null)}
        />

      ) : null}

    </SettingsShell>
  );

}


function UsersTab({
  users,
  loading,
  isOwner,
  onAddEmployee,
  onAddAdministrator,
  onLifecycleAction,
  profiles,
  onChangeProfile
}: {
  users: UserWithEmployee[];
  loading: boolean;
  isOwner: boolean;
  onAddEmployee: () => void;
  onAddAdministrator: () => void;
  onLifecycleAction: (userId: number, action: "disable" | "archive" | "restore" | "resetPassword") => void;
  profiles: PermissionProfileWithKeys[];
  onChangeProfile: (userId: number, permissionProfileId: number) => void;
}): JSX.Element {

  const { t } = useLanguage();

  return (
    <div>

      <div className="user-mgmt-toolbar">

        <button className="user-mgmt-secondary-btn" onClick={onAddEmployee}>
          <Plus size={15} />
          {t("settingsUserManagement.addEmployeeLogin")}
        </button>

        {isOwner ? (
          <button className="user-mgmt-secondary-btn" onClick={onAddAdministrator}>
            <ShieldCheck size={15} />
            {t("settingsUserManagement.addAdministrator")}
          </button>
        ) : null}

      </div>

      <div className="user-mgmt-table">

        <div className="user-mgmt-row user-mgmt-row-header">
          <span>{t("settingsUserManagement.username")}</span>
          <span>{t("settingsUserManagement.type")}</span>
          <span>{t("settingsUserManagement.linkedEmployee")}</span>
          <span>{t("settingsUserManagement.permissionProfile")}</span>
          <span>{t("settingsUserManagement.status")}</span>
          <span>{t("settingsUserManagement.actions")}</span>
        </div>

        {loading ? (
          <div className="user-mgmt-empty">{t("settingsUserManagement.loadingUsers")}</div>
        ) : users.length === 0 ? (
          <div className="user-mgmt-empty">{t("settingsUserManagement.noUsersFound")}</div>
        ) : (
          users.map(row => (

            <div className="user-mgmt-row" key={row.id}>

              <span className="user-mgmt-username">{row.username}</span>

              <span>{userTypeLabel(row.user_type, t)}</span>

              <span>
                {row.employee_first_name
                  ? `${row.employee_first_name} ${row.employee_last_name}`
                  : "—"}
              </span>

              <span>
                {row.user_type === "employee" && row.status === "active" ? (
                  <select
                    className="user-mgmt-profile-select"
                    value={profiles.find(p => p.name === row.permission_profile_name)?.id ?? ""}
                    onChange={(e) => {
                      const nextId = Number(e.target.value);
                      if (Number.isFinite(nextId) && nextId > 0) {
                        onChangeProfile(row.id, nextId);
                      }
                    }}
                  >
                    <option value="" disabled>{t("settingsUserManagement.selectAProfile")}</option>
                    {profiles.map(profile => (
                      <option key={profile.id} value={profile.id}>{profile.name}</option>
                    ))}
                  </select>
                ) : (
                  row.permission_profile_name ?? "—"
                )}
              </span>

              <span>
                <span className={`user-mgmt-status user-mgmt-status-${row.status}`}>
                  {statusLabel(row.status)}
                </span>
              </span>

              <span className="user-mgmt-actions">

                {row.user_type === "owner" ? (
                  <span className="user-mgmt-hint">—</span>
                ) : row.status === "active" ? (
                  <>
                    <button
                      className="icon-action-btn"
                      title={t("settingsUserManagement.resetPasswordReprint")}
                      onClick={() => onLifecycleAction(row.id, "resetPassword")}
                    >
                      <KeyRound size={15} />
                    </button>
                    <button
                      className="icon-action-btn"
                      title={t("settingsUserManagement.disable")}
                      onClick={() => onLifecycleAction(row.id, "disable")}
                    >
                      <UserX size={15} />
                    </button>
                    <button
                      className="icon-action-btn"
                      title={t("settingsUserManagement.archive")}
                      onClick={() => onLifecycleAction(row.id, "archive")}
                    >
                      <Archive size={15} />
                    </button>
                  </>
                ) : (
                  <button
                    className="icon-action-btn"
                    title={t("settingsUserManagement.restore")}
                    onClick={() => onLifecycleAction(row.id, "restore")}
                  >
                    <RotateCcw size={15} />
                  </button>
                )}

              </span>

            </div>

          ))
        )}

      </div>

    </div>
  );

}


function requesterTypeLabel(type: string, t: (key: string) => string): string {

  return type === "administrator" ? t("settingsUserManagement.administrator") : t("settingsUserManagement.employee");

}

function resetRequestStatusLabel(status: string, t: (key: string) => string): string {

  switch (status) {
    case "pending": return t("settingsUserManagement.pending");
    case "approved": return t("settingsUserManagement.approved");
    case "completed": return t("settingsUserManagement.completed");
    case "expired": return t("settingsUserManagement.expired");
    case "cancelled": return t("settingsUserManagement.cancelled");
    default: return status;
  }

}

function auditEventLabel(event: string, t: (key: string) => string): string {

  switch (event) {
    case "requested": return t("settingsUserManagement.requestSubmitted");
    case "approved": return t("settingsUserManagement.resetCodeGenerated");
    case "completed": return t("settingsUserManagement.passwordResetCompleted");
    case "expired": return t("settingsUserManagement.resetCodeExpired");
    case "cancelled": return t("settingsUserManagement.requestCancelled");
    default: return event;
  }

}

function ResetRequestsTab({
  requests,
  loading,
  onGenerateCode,
  onApproveUsername
}: {
  requests: PasswordResetRequestRecord[];
  loading: boolean;
  onGenerateCode: (request: PasswordResetRequestRecord) => void;
  onApproveUsername: (request: PasswordResetRequestRecord) => void;
}): JSX.Element {

  const { t } = useLanguage();
  const [view, setView] = useState<"pending" | "history">("pending");
  const [history, setHistory] = useState<PasswordResetRequestRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [auditRequest, setAuditRequest] = useState<PasswordResetRequestRecord | null>(null);

  useEffect(() => {

    if (view !== "history") {
      return;
    }

    let cancelled = false;

    setHistoryLoading(true);

    listPasswordResetRequestHistory()
      .then(rows => {
        if (!cancelled) setHistory(rows);
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });

    return () => {
      cancelled = true;
    };

  }, [view]);

  const rows = view === "pending" ? requests : history;
  const isLoading = view === "pending" ? loading : historyLoading;

  return (
    <div>

      <p className="user-mgmt-hint">
        {t("settingsUserManagement.identityVerificationNote")}
      </p>

      <div className="user-mgmt-toolbar">

        <button
          className={`user-mgmt-secondary-btn ${view === "pending" ? "active" : ""}`}
          onClick={() => setView("pending")}
        >
          {t("settingsUserManagement.pending")}
        </button>

        <button
          className={`user-mgmt-secondary-btn ${view === "history" ? "active" : ""}`}
          onClick={() => setView("history")}
        >
          {t("settingsUserManagement.requestHistory")}
        </button>

      </div>

      <div className="user-mgmt-table">

        {view === "pending" ? (

          <div className="user-mgmt-row user-mgmt-row-resetreq user-mgmt-row-header">
            <span>{t("settingsUserManagement.username")}</span>
            <span>{t("settingsUserManagement.requester")}</span>
            <span>{t("settingsUserManagement.kind")}</span>
            <span>{t("settingsUserManagement.requested")}</span>
            <span>{t("settingsUserManagement.actions")}</span>
          </div>

        ) : (

          <div className="user-mgmt-row user-mgmt-row-header user-mgmt-row-header-history">
            <span>{t("settingsUserManagement.username")}</span>
            <span>{t("settingsUserManagement.kind")}</span>
            <span>{t("settingsUserManagement.status")}</span>
            <span>{t("settingsUserManagement.requested")}</span>
            <span>{t("settingsUserManagement.approvedBy")}</span>
            <span>{t("settingsUserManagement.completed")}</span>
            <span>{t("settingsUserManagement.actions")}</span>
          </div>

        )}

        {isLoading ? (
          <div className="user-mgmt-empty">{t("settingsUserManagement.loadingRequests")}</div>
        ) : rows.length === 0 ? (
          <div className="user-mgmt-empty">
            {view === "pending" ? t("settingsUserManagement.noPendingRequests") : t("settingsUserManagement.noRequestsYet")}
          </div>
        ) : view === "pending" ? (

          requests.map(request => (

            <div className="user-mgmt-row user-mgmt-row-resetreq" key={request.id}>

              <span className="user-mgmt-username">
                {request.full_name || request.username}
                <br />
                <small style={{ color: "#9ca3af", fontWeight: 400 }}>{request.username}</small>
              </span>

              <span>{requesterTypeLabel(request.user_type, t)}</span>

              <span>{request.request_type === "username" ? t("settingsUserManagement.usernameRecovery") : t("settingsUserManagement.passwordReset")}</span>

              <span>{new Date(request.created_at).toLocaleString()}</span>

              <span className="user-mgmt-actions">
                {request.request_type === "username" ? (
                  <button
                    className="icon-action-btn"
                    title={t("settingsUserManagement.sendUsernameViaMessage")}
                    onClick={() => onApproveUsername(request)}
                  >
                    <KeyRound size={15} />
                  </button>
                ) : (
                  <button
                    className="icon-action-btn"
                    title={t("settingsUserManagement.generateResetCode")}
                    onClick={() => onGenerateCode(request)}
                  >
                    <KeyRound size={15} />
                  </button>
                )}
              </span>

            </div>

          ))

        ) : (

          history.map(request => (

            <div className="user-mgmt-row user-mgmt-row-history" key={request.id}>

              <span className="user-mgmt-username">
                {request.full_name || request.username}
                <br />
                <small style={{ color: "#9ca3af", fontWeight: 400 }}>{request.username}</small>
              </span>

              <span>{request.request_type === "username" ? t("settingsUserManagement.usernameRecovery") : t("settingsUserManagement.passwordReset")}</span>

              <span>
                <span className={`user-mgmt-status user-mgmt-reset-status-${request.status}`}>
                  {resetRequestStatusLabel(request.status, t)}
                </span>
              </span>

              <span>{new Date(request.created_at).toLocaleString()}</span>

              <span>{request.reviewed_by_full_name ?? request.reviewed_by_username ?? "—"}</span>

              <span>{request.resolved_at ? new Date(request.resolved_at).toLocaleString() : "—"}</span>

              <span className="user-mgmt-actions">
                <button
                  className="icon-action-btn"
                  title={t("settingsUserManagement.viewAuditLog")}
                  onClick={() => setAuditRequest(request)}
                >
                  <FileClock size={15} />
                </button>
              </span>

            </div>

          ))

        )}

      </div>

      {auditRequest ? (
        <AuditLogModal request={auditRequest} onClose={() => setAuditRequest(null)} />
      ) : null}

    </div>
  );

}


function AuditLogModal({
  request,
  onClose
}: {
  request: PasswordResetRequestRecord;
  onClose: () => void;
}): JSX.Element {

  const { t } = useLanguage();
  const [entries, setEntries] = useState<PasswordResetAuditLogRecord[] | null>(null);

  useEffect(() => {

    let cancelled = false;

    getPasswordResetAuditLog(request.id).then(rows => {
      if (!cancelled) setEntries(rows);
    });

    return () => {
      cancelled = true;
    };

  }, [request.id]);

  return (
    <div className="user-mgmt-modal-overlay">
      <div className="user-mgmt-modal" onClick={event => event.stopPropagation()}>

        <div className="user-mgmt-modal-header">
          <h3><FileClock size={16} /> {t("settingsUserManagement.auditLogFor")} {request.username}</h3>
          <button className="user-mgmt-icon-btn" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="user-mgmt-audit-log">

          {entries === null ? (
            <p className="user-mgmt-hint">{t("settingsUserManagement.loadingEllipsis")}</p>
          ) : entries.length === 0 ? (
            <p className="user-mgmt-hint">{t("settingsUserManagement.noAuditEventsRecorded")}</p>
          ) : (
            entries.map(entry => (
              <div className="user-mgmt-audit-entry" key={entry.id}>
                <span className="user-mgmt-audit-entry-event">{auditEventLabel(entry.event, t)}</span>
                <span className="user-mgmt-audit-entry-time">{new Date(entry.created_at).toLocaleString()}</span>
                {entry.detail ? <span className="user-mgmt-audit-entry-detail">{entry.detail}</span> : null}
              </div>
            ))
          )}

        </div>

        <div className="user-mgmt-modal-actions">
          <button className="save-btn" onClick={onClose}>{t("settingsUserManagement.close")}</button>
        </div>

      </div>
    </div>
  );

}


function ProfilesTab({
  profiles,
  isOwner,
  onCreate,
  onEdit,
  onDelete
}: {
  profiles: PermissionProfileWithKeys[];
  isOwner: boolean;
  onCreate: () => void;
  onEdit: (profile: PermissionProfileWithKeys) => void;
  onDelete: (id: number) => void;
}): JSX.Element {

  const { t } = useLanguage();

  return (
    <div>

      {isOwner ? (
        <div className="user-mgmt-toolbar">
          <button className="user-mgmt-secondary-btn" onClick={onCreate}>
            <Plus size={15} />
            {t("settingsUserManagement.newProfile")}
          </button>
        </div>
      ) : null}

      <div className="user-mgmt-profile-grid">

        {profiles.map(profile => (

          <div className="user-mgmt-profile-card" key={profile.id}>

            <div className="user-mgmt-profile-card-header">
              <strong>{profile.name}</strong>
              {profile.is_system ? <span className="user-mgmt-badge">{t("settingsUserManagement.system")}</span> : null}
            </div>

            <p className="user-mgmt-profile-description">{profile.description}</p>

            <p className="user-mgmt-hint">{profile.permissionKeys.length} {t("settingsUserManagement.permissionsGranted")}</p>

            {isOwner ? (
              <div className="user-mgmt-profile-card-actions">

                <button className="user-mgmt-text-btn" onClick={() => onEdit(profile)}>
                  {t("settingsUserManagement.edit")}
                </button>

                {!profile.is_system ? (
                  <button
                    className="user-mgmt-text-btn danger"
                    onClick={() => onDelete(profile.id)}
                  >
                    {t("settingsUserManagement.delete")}
                  </button>
                ) : null}

              </div>
            ) : null}

          </div>

        ))}

      </div>

    </div>
  );

}


function AddEmployeeLoginModal({
  employees,
  profiles,
  onClose,
  onCreated
}: {
  employees: Employee[];
  profiles: PermissionProfileWithKeys[];
  onClose: () => void;
  onCreated: (result: CreateUserResult, employee: Employee, profile: PermissionProfileWithKeys) => void;
}): JSX.Element {

  const { t } = useLanguage();
  const [employeeId, setEmployeeId] = useState<number | "">("");
  const [profileId, setProfileId] = useState<number | "">("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(): Promise<void> {

    if (!employeeId || !profileId) {
      return;
    }

    const employee = employees.find(candidate => candidate.id === employeeId);
    const profile = profiles.find(candidate => candidate.id === profileId);

    if (!employee || !profile) {
      return;
    }

    setSubmitting(true);

    try {

      const result = await createEmployeeLogin(Number(employeeId), Number(profileId));

      onCreated(result, employee, profile);

    }
    finally {

      setSubmitting(false);

    }

  }

  return (
    <div className="user-mgmt-modal-overlay">
      <div className="user-mgmt-modal" onClick={event => event.stopPropagation()}>

        <div className="user-mgmt-modal-header">
          <h3>{t("settingsUserManagement.addEmployeeLogin")}</h3>
          <button className="user-mgmt-icon-btn" onClick={onClose}><X size={18} /></button>
        </div>

        {employees.length === 0 ? (

          <p className="user-mgmt-hint">
            {t("settingsUserManagement.everyEmployeeHasLogin")}
          </p>

        ) : (

          <>

            <div className="user-mgmt-form-group">
              <label>{t("settingsUserManagement.employeeLabel")}</label>
              <select value={employeeId} onChange={event => setEmployeeId(Number(event.target.value) || "")}>
                <option value="">{t("settingsUserManagement.selectAnEmployee")}</option>
                {employees.map(employee => (
                  <option key={employee.id} value={employee.id}>
                    {employee.first_name} {employee.last_name} ({employee.employee_number})
                  </option>
                ))}
              </select>
            </div>

            <div className="user-mgmt-form-group">
              <label>{t("settingsUserManagement.permissionProfile")}</label>
              <select value={profileId} onChange={event => setProfileId(Number(event.target.value) || "")}>
                <option value="">{t("settingsUserManagement.selectAProfileEllipsis")}</option>
                {profiles.map(profile => (
                  <option key={profile.id} value={profile.id}>{profile.name}</option>
                ))}
              </select>
            </div>

            <div className="user-mgmt-modal-actions">
              <button className="cancel-btn" onClick={onClose} disabled={submitting}>{t("settingsUserManagement.cancel")}</button>
              <button
                className="save-btn"
                onClick={handleSubmit}
                disabled={submitting || !employeeId || !profileId}
              >
                {submitting ? t("settingsUserManagement.creating") : t("settingsUserManagement.createLogin")}
              </button>
            </div>

          </>

        )}

      </div>
    </div>
  );

}


function ProfileEditorModal({
  profile,
  onClose,
  onSaved
}: {
  profile: PermissionProfileWithKeys | null;
  onClose: () => void;
  onSaved: () => void;
}): JSX.Element {

  const { t } = useLanguage();
  const [name, setName] = useState(profile?.name ?? "");
  const [description, setDescription] = useState(profile?.description ?? "");
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(
    new Set(profile?.permissionKeys ?? [])
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleKey(key: string): void {

    setSelectedKeys(prev => {

      const next = new Set(prev);

      if (next.has(key)) {
        next.delete(key);
      }
      else {
        next.add(key);
      }

      return next;

    });

  }

  async function handleSubmit(): Promise<void> {

    if (!name.trim()) {
      setError(t("settingsUserManagement.profileNameRequired"));
      return;
    }

    setSubmitting(true);
    setError(null);

    try {

      if (profile) {
        await updatePermissionProfile(profile.id, name.trim(), description, Array.from(selectedKeys));
      }
      else {
        await createPermissionProfile(name.trim(), description, Array.from(selectedKeys));
      }

      onSaved();

    }
    catch (submitError) {

      setError(submitError instanceof Error ? submitError.message : t("settingsUserManagement.failedToSaveProfile"));

    }
    finally {

      setSubmitting(false);

    }

  }

  return (
    <div className="user-mgmt-modal-overlay">
      <div className="user-mgmt-modal user-mgmt-modal-wide" onClick={event => event.stopPropagation()}>

        <div className="user-mgmt-modal-header">
          <h3>{profile ? t("settingsUserManagement.editPermissionProfile") : t("settingsUserManagement.newPermissionProfile")}</h3>
          <button className="user-mgmt-icon-btn" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="user-mgmt-form-group">
          <label>{t("settingsUserManagement.profileName")}</label>
          <input
            type="text"
            value={name}
            onChange={event => setName(event.target.value)}
            disabled={Boolean(profile?.is_system)}
          />
        </div>

        <div className="user-mgmt-form-group">
          <label>{t("settingsUserManagement.descriptionField")}</label>
          <input
            type="text"
            value={description}
            onChange={event => setDescription(event.target.value)}
          />
        </div>

        <div className="user-mgmt-permission-grid">

          <div className="user-mgmt-permission-grid-header">
            <span></span>
            {PERMISSION_ACTIONS.map(action => (
              <span key={action}>{action}</span>
            ))}
          </div>

          {PERMISSION_MODULES.map((permissionModule: PermissionModule) => (

            <div className="user-mgmt-permission-grid-row" key={permissionModule}>

              <span className="user-mgmt-permission-module-label">{permissionModule}</span>

              {PERMISSION_ACTIONS.map((action: PermissionAction) => {

                const key = `${permissionModule}.${action}`;

                return (
                  <label key={key} className="user-mgmt-permission-checkbox">
                    <input
                      type="checkbox"
                      checked={selectedKeys.has(key)}
                      onChange={() => toggleKey(key)}
                    />
                  </label>
                );

              })}

            </div>

          ))}

        </div>

        {error ? <p className="user-mgmt-error">{error}</p> : null}

        <div className="user-mgmt-modal-actions">
          <button className="cancel-btn" onClick={onClose} disabled={submitting}>{t("settingsUserManagement.cancel")}</button>
          <button className="save-btn" onClick={handleSubmit} disabled={submitting}>
            {submitting ? t("settingsUserManagement.savingEllipsis") : t("settingsUserManagement.saveProfile")}
          </button>
        </div>

      </div>
    </div>
  );

}


function ResetCodeModal({
  username,
  resetCode,
  onClose
}: {
  username: string;
  resetCode: string;
  onClose: () => void;
}): JSX.Element {

  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);

  async function handleCopy(): Promise<void> {

    await navigator.clipboard.writeText(resetCode);

    setCopied(true);

    window.setTimeout(() => setCopied(false), 2000);

  }

  return (
    <div className="user-mgmt-modal-overlay">
      <div className="user-mgmt-modal" onClick={event => event.stopPropagation()}>

        <div className="user-mgmt-modal-header">
          <h3><KeyRound size={16} /> {t("settingsUserManagement.resetCode")}</h3>
          <button className="user-mgmt-icon-btn" onClick={onClose}><X size={18} /></button>
        </div>

        <p className="user-mgmt-hint">
          {t("settingsUserManagement.resetCodeSentPrefix")} <strong>{username}</strong>{t("settingsUserManagement.resetCodeSentSuffix")}
        </p>

        <div className="user-mgmt-credentials-box">
          <div><span>{t("settingsUserManagement.resetCode")}</span><strong>{resetCode}</strong></div>
        </div>

        <div className="user-mgmt-modal-actions">
          <button className="cancel-btn" onClick={handleCopy}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? t("settingsUserManagement.copied") : t("settingsUserManagement.copy")}
          </button>
          <button className="save-btn" onClick={onClose}>{t("settingsUserManagement.done")}</button>
        </div>

      </div>
    </div>
  );

}


function CredentialsModal({
  credential,
  onClose
}: {
  credential: CredentialPrintParams;
  onClose: () => void;
}): JSX.Element {

  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);

  const summary = useMemo(() => {

    return `Username: ${credential.username}\nTemporary Password: ${credential.temporaryPassword}`;

  }, [credential]);

  // The preview below must be pixel-identical to the exported/printed
  // PDF, so it renders the exact same buildCredentialHtml() output
  // with the exact same credential data -- there is no separate
  // preview template to fall out of sync.
  useEffect(() => {

    let cancelled = false;

    setPreviewHtml(null);

    buildCredentialHtml(credential).then(html => {

      if (!cancelled) setPreviewHtml(html);

    });

    return () => {
      cancelled = true;
    };

  }, [credential]);

  async function handleCopy(): Promise<void> {

    await navigator.clipboard.writeText(summary);

    setCopied(true);

    window.setTimeout(() => setCopied(false), 2000);

  }

  async function handlePrint(): Promise<void> {

    setBusy(true);

    try {

      const html = await buildCredentialHtml(credential);

      await showPrintPreview({
        html,
        documentLabel: buildPrintDocumentLabel(
          t("userManagement.accountCredentials"),
          credential?.username
        )
      });

    }
    catch (error) {

      console.error("Failed to print credentials:", error);
      window.alert(t("forgotPassword.printPreviewFailed"));

    }
    finally {

      setBusy(false);

    }

  }

  async function handleSavePdf(): Promise<void> {

    setBusy(true);

    try {

      const html = await buildCredentialHtml(credential);

      const result = await exportCredentialsPdf(html, `${credential.username}-credentials.pdf`);

      if (!result.success && !result.cancelled) {
        window.alert(result.error ?? t("settingsUserManagement.couldNotSavePdf"));
      }

    }
    finally {

      setBusy(false);

    }

  }

  return (
    <div className="user-mgmt-modal-overlay">
      <div className="user-mgmt-modal user-mgmt-modal-wide" onClick={event => event.stopPropagation()}>

        <div className="user-mgmt-modal-header">
          <h3><KeyRound size={16} /> {t("settingsUserManagement.accountCredentials")}</h3>
          <button className="user-mgmt-icon-btn" onClick={onClose}><X size={18} /></button>
        </div>

        <p className="user-mgmt-hint">
          {t("settingsUserManagement.saveCredentialsNote")}
        </p>

        <div className="user-mgmt-credentials-box">
          <div><span>{t("settingsUserManagement.username")}</span><strong>{credential.username}</strong></div>
          <div><span>{t("settingsUserManagement.temporaryPassword")}</span><strong>{credential.temporaryPassword}</strong></div>
        </div>

        {/* Same template + same data as the printed/exported PDF -- see
            buildCredentialHtml in credential-print-template.ts -- so
            this preview is always visually identical to it. */}
        <div className="user-mgmt-credentials-preview">
          {previewHtml ? (
            <iframe title={t("settingsUserManagement.credentialDocumentPreview")} srcDoc={previewHtml} />
          ) : (
            <div className="user-mgmt-credentials-preview-loading">{t("settingsUserManagement.loadingPreview")}</div>
          )}
        </div>

        <div className="user-mgmt-modal-actions">
          <button className="cancel-btn" onClick={handleCopy}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? t("settingsUserManagement.copied") : t("settingsUserManagement.copy")}
          </button>
          <button className="cancel-btn" onClick={handlePrint} disabled={busy}>
            <Printer size={14} />
            {t("settingsUserManagement.print")}
          </button>
          <button className="cancel-btn" onClick={handleSavePdf} disabled={busy}>
            <FileDown size={14} />
            {t("settingsUserManagement.savePdf")}
          </button>
          <button className="save-btn" onClick={onClose}>{t("settingsUserManagement.done")}</button>
        </div>

      </div>
    </div>
  );

}


// ===================================================================
// Audit Log Tab (Phase 7)
//
// Read-only browsing of the general-purpose audit trail (see
// electron/main/main.ts's logAudit() and
// src/repositories/audit-log-repository.ts) covering Product /
// Customer / Order / Inventory / Certificate / Employee /
// User-Permission / Settings changes. Owner/Administrator only --
// enforced server-side by the auditLog:list / auditLog:export IPC
// handlers, this component doesn't duplicate that check, it just
// won't render useful data for anyone else since the IPC call itself
// would throw.
// ===================================================================

function auditModuleLabel(module: string, t: (key: string) => string): string {

  switch (module) {
    case "products": return t("settingsUserManagement.products");
    case "customers": return t("settingsUserManagement.customers");
    case "orders": return t("settingsUserManagement.orders");
    case "inventory": return t("settingsUserManagement.inventory");
    case "certificates": return t("settingsUserManagement.certificates");
    case "employees": return t("settingsUserManagement.employees");
    case "permissions": return t("settingsUserManagement.userPermissions");
    case "settings": return t("settingsUserManagement.settings");
    default: return module;
  }

}

function auditActionLabel(action: string, t: (key: string) => string): string {

  switch (action) {
    case "create": return t("settingsUserManagement.created");
    case "edit": return t("settingsUserManagement.edited");
    case "delete": return t("settingsUserManagement.deleted");
    case "adjust": return t("settingsUserManagement.adjusted");
    default: return action;
  }

}

function downloadAuditCsv(entries: AuditLogEntry[], t: (key: string) => string): void {

  function escapeCsv(value: unknown): string {
    const str = value === null || value === undefined ? "" : String(value);
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  }

  const header = [
    t("settingsUserManagement.dateTime"),
    t("settingsUserManagement.user"),
    t("settingsUserManagement.module"),
    t("settingsUserManagement.action"),
    t("settingsUserManagement.record"),
    "Old Value",
    "New Value"
  ];

  const lines = [header.map(escapeCsv).join(",")];

  entries.forEach(entry => {
    lines.push([
      new Date(entry.created_at).toLocaleString(),
      entry.username ?? "—",
      auditModuleLabel(entry.module, t),
      auditActionLabel(entry.action, t),
      entry.record_label ?? entry.record_id ?? "—",
      entry.old_value ?? "",
      entry.new_value ?? ""
    ].map(escapeCsv).join(","));
  });

  const blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

}

function AuditLogTab(): JSX.Element {

  const { t } = useLanguage();
  const [entries, setEntries] = useState<AuditLogEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [moduleFilter, setModuleFilter] = useState<string>("");
  const [actionFilter, setActionFilter] = useState<string>("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  async function load(): Promise<void> {

    setLoading(true);

    try {

      const filter: { module?: string; action?: string; fromDate?: string; toDate?: string; search?: string } = {};

      if (moduleFilter) filter.module = moduleFilter;
      if (actionFilter) filter.action = actionFilter;
      if (fromDate) filter.fromDate = fromDate;
      if (toDate) filter.toDate = toDate;
      if (search.trim()) filter.search = search.trim();

      const result = await window.mooral.auditLog.list(filter);
      setEntries(result);

    }
    catch (error) {

      console.error("Failed to load audit log:", error);
      setEntries([]);

    }
    finally {

      setLoading(false);

    }

  }

  useEffect(() => {

    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleExport(): Promise<void> {

    try {

      const filter: { module?: string; action?: string; fromDate?: string; toDate?: string; search?: string } = {};

      if (moduleFilter) filter.module = moduleFilter;
      if (actionFilter) filter.action = actionFilter;
      if (fromDate) filter.fromDate = fromDate;
      if (toDate) filter.toDate = toDate;
      if (search.trim()) filter.search = search.trim();

      const result = await window.mooral.auditLog.export(filter);
      downloadAuditCsv(result, t);

    }
    catch (error) {

      alert(error instanceof Error ? error.message : t("settingsUserManagement.failedToExportAuditLog"));

    }

  }

  return (
    <div>

      <div className="user-mgmt-audit-filters">

        <select value={moduleFilter} onChange={e => setModuleFilter(e.target.value)}>
          <option value="">{t("settingsUserManagement.allModules")}</option>
          {PERMISSION_MODULES.filter(m => m !== "dashboard" && m !== "invoices" && m !== "reports").map(m => (
            <option key={m} value={m}>{auditModuleLabel(m, t)}</option>
          ))}
        </select>

        <select value={actionFilter} onChange={e => setActionFilter(e.target.value)}>
          <option value="">{t("settingsUserManagement.allActions")}</option>
          <option value="create">{t("settingsUserManagement.created")}</option>
          <option value="edit">{t("settingsUserManagement.edited")}</option>
          <option value="delete">{t("settingsUserManagement.deleted")}</option>
          <option value="adjust">{t("settingsUserManagement.adjusted")}</option>
        </select>

        <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} />
        <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} />

        <input
          type="text"
          placeholder={t("settingsUserManagement.searchRecordOrUser")}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />

        <button className="user-mgmt-secondary-btn" onClick={load} disabled={loading}>
          {loading ? t("settingsUserManagement.loadingEllipsis") : t("settingsUserManagement.applyFilters")}
        </button>

        <button className="user-mgmt-secondary-btn" onClick={handleExport} disabled={loading || !entries?.length}>
          <Download size={15} />
          {t("settingsUserManagement.exportCsv")}
        </button>

      </div>

      <div className="user-mgmt-audit-table">

        <div className="user-mgmt-audit-table-header">
          <span>{t("settingsUserManagement.dateTime")}</span>
          <span>{t("settingsUserManagement.user")}</span>
          <span>{t("settingsUserManagement.module")}</span>
          <span>{t("settingsUserManagement.action")}</span>
          <span>{t("settingsUserManagement.record")}</span>
        </div>

        {loading ? (
          <p className="user-mgmt-hint">{t("settingsUserManagement.loadingEllipsis")}</p>
        ) : !entries?.length ? (
          <p className="user-mgmt-hint">{t("settingsUserManagement.noAuditEventsMatch")}</p>
        ) : (
          entries.map(entry => (
            <div key={entry.id}>

              <div
                className="user-mgmt-audit-table-row"
                onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
              >
                <span>{new Date(entry.created_at).toLocaleString()}</span>
                <span>{entry.username ?? "—"}</span>
                <span>{auditModuleLabel(entry.module, t)}</span>
                <span>{auditActionLabel(entry.action, t)}</span>
                <span>{entry.record_label ?? entry.record_id ?? "—"}</span>
              </div>

              {expandedId === entry.id ? (
                <div className="user-mgmt-audit-detail">
                  {entry.old_value ? (
                    <div>
                      <strong>{t("settingsUserManagement.before")}</strong>
                      <pre>{entry.old_value}</pre>
                    </div>
                  ) : null}
                  {entry.new_value ? (
                    <div>
                      <strong>{t("settingsUserManagement.after")}</strong>
                      <pre>{entry.new_value}</pre>
                    </div>
                  ) : null}
                  {!entry.old_value && !entry.new_value ? (
                    <p className="user-mgmt-hint">No additional detail recorded for this event.</p>
                  ) : null}
                </div>
              ) : null}

            </div>
          ))
        )}

      </div>

    </div>
  );

}
