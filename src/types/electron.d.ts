export {};

declare global {


  interface Product {

    id?: number;

    product_id: string;

    name: string;

    category: string;

    sku: string;

    price: number;

    stock: number;

    created_at?: string;

    updated_at?: string;

  }





  interface Customer {

    id?: number;

    customer_id: string;

    name: string;

    phone: string;

    email: string;

    address: string;

    created_at?: string;

    updated_at?: string;

  }





  interface OrderItem {

    product_id: string;

    product_name: string;

    quantity: number;

    price: number;

    total: number;

  }



  interface Order {

    id?: number;

    order_id: string;

    customer_id: string;

    customer_name: string;

    product_id: string;

    product_name: string;

    quantity: number;

    price: number;

    total: number;

    status: string;

    items?: OrderItem[];

    created_at?: string;

    updated_at?: string;

  }



  interface OrderCreateInput {

    order_id: string;

    customer_id: string;

    customer_name: string;

    status: string;

    items: OrderItem[];

  }





  interface InventoryTransaction {

    id?: number;

    product_id: string;

    type: "IN" | "OUT";

    quantity: number;

    note?: string;

    created_at?: string;

  }




  interface Transaction {

    id?: number;

    transaction_id: string;

    type: "Income" | "Expense";

    category: string;

    description: string;

    amount: number;

    payment_method: string;

    reference_no?: string;

    transaction_date: string;

    notes?: string;

    created_at?: string;

    updated_at?: string;

    source_invoice_id?: string | null;

  }




  interface Account {
    id: number;
    code: string;
    name: string;
    type: "Asset" | "Liability" | "Equity" | "Income" | "Expense";
    is_system: number;
    created_at?: string;
  }

  interface AccountSummaryRow extends Account {
    balance: number;
    totalDebit: number;
    totalCredit: number;
  }

  interface JournalEntry {
    id: number;
    journal_id: string;
    entry_date: string;
    debit_account_id: number;
    debit_account_name: string;
    credit_account_id: number;
    credit_account_name: string;
    amount: number;
    reference: string | null;
    reference_type: string | null;
    description: string | null;
    created_at?: string;
  }

  interface LedgerEntry {
    id: number;
    journal_id: string | null;
    account_id: number;
    account_name: string;
    customer_id: string | null;
    customer_name: string | null;
    entry_date: string;
    debit: number;
    credit: number;
    running_balance: number;
    reference_id: string | null;
    reference_type: string | null;
    description: string | null;
    notes: string | null;
    created_at?: string;
  }




  interface AppNotification {

    id?: number;

    module: string;

    action: string;

    message: string;

    user?: string;

    before?: string | null;

    after?: string | null;

    created_at?: string;

  }




  interface Certificate {

    id?: number;

    certificate_id: string;

    certificate_category: "Employee" | "Product";

    certificate_type: string;

    customer_id?: string;

    customer_name?: string;

    employee_name?: string;

    product_id?: string;

    product_name?: string;

    serial_number?: string;

    // Task 9 snapshot fields -- copied from the selected Employee/Product
    // record at save time so certificates never depend on a live join
    // back to employees/products (deleting either does not affect
    // existing certificates, since nothing here is an enforced FK).
    employee_id?: string;

    employee_number_snapshot?: string;

    employee_name_snapshot?: string;

    department_snapshot?: string;

    designation_snapshot?: string;

    // Certificate Automation snapshot fields -- see
    // certificate-repository.ts for the full rationale.
    employment_type_snapshot?: string;

    joining_date_snapshot?: string | null;

    employment_status_snapshot?: string;

    product_name_snapshot?: string;

    category_snapshot?: string;

    sku_snapshot?: string;

    title: string;

    description?: string;

    issue_date?: string;

    expiry_date?: string | null;

    status: string;

    // Set exactly once, the moment this Employee Certificate is first
    // successfully printed/exported -- never overwritten after that.
    // Deliberately separate from updated_at.
    printed_at?: string | null;

    created_at?: string;

    updated_at?: string;

  }




  interface Employee {

    id?: number;

    employee_number: string;

    has_photo?: boolean;

    first_name: string;

    last_name: string;

    gender?: string;

    date_of_birth?: string | null;

    phone: string;

    email?: string;

    address?: string;

    department: string;

    designation: string;

    joining_date?: string | null;

    employment_status: string;

    employment_type?: string;

    resignation_date?: string | null;

    contract_start_date?: string | null;

    contract_end_date?: string | null;

    salary?: number;

    emergency_contact_name?: string;

    emergency_contact_phone?: string;

    // Deprecated: superseded by identity_type/identity_number below.
    // Left in the type (and the database column stays) purely so any
    // historical data remains reachable -- the UI no longer reads or
    // writes it.
    nid_passport?: string;

    identity_type?: string;

    identity_number?: string;

    notes?: string;

    created_at?: string;

    updated_at?: string;

  }


  interface EmployeeContract {

    id?: number;

    employee_id: number;

    contract_start_date: string;

    contract_end_date?: string | null;

    extension_reason?: string;

    previous_contract_id?: number | null;

    is_current: boolean;

    contract_status?: "Active" | "Expiring Soon" | "Expired";

    created_at?: string;

    updated_at?: string;

  }




  interface InvoiceItem {

    product_id?: string;

    product_name: string;

    quantity: number;

    price: number;

    total: number;

  }


  interface Invoice {

    id?: number;

    invoice_id: string;

    /**
     * The order this invoice was automatically created from. Manual
     * invoice creation has been removed -- invoices always originate
     * from an Order transitioning to "Completed". Only legacy
     * invoices created before this link existed may have this unset.
     */
    order_id?: string;

    customer_id?: string;

    customer_name: string;

    items?: InvoiceItem[];

    subtotal: number;

    discount: number;

    tax: number;

    total: number;

    paid: number;

    due: number;

    payment_method: string;

    status: string;

    invoice_date: string;

    due_date?: string;

    notes?: string;

    created_at?: string;

    updated_at?: string;

  }


  interface InvoiceSummary {

    totalInvoices: number;

    totalAmount: number;

    totalPaid: number;

    totalDue: number;

    paidCount: number;

    unpaidCount: number;

    partialCount: number;

    overdueCount: number;

  }









  interface DatabaseInfo {

    path: string;

    sizeBytes: number;

    lastModified: string | null;

    tableCounts: Record<string, number>;

  }


  interface DatabaseBackupResult {

    success: boolean;

    filePath?: string;

    cancelled?: boolean;

    error?: string;

  }


  interface DatabaseRestoreResult {

    success: boolean;

    cancelled?: boolean;

    error?: string;

    safetyBackupPath?: string;

  }


  interface DatabaseIntegrityResult {

    success: boolean;

    ok: boolean;

    detail: string;

    error?: string;

  }



  interface AppInfo {

    appName: string;

    appVersion: string;

    electronVersion: string;

    chromeVersion: string;

    nodeVersion: string;

    platform: string;

    arch: string;

  }




  // ===============================
  // LICENSE (v2)
  // ===============================
  //
  // Mirrors electron/main/license-v2/license/schema.ts and
  // license-manager.ts. Duplicated here because that module lives in
  // the main process and isn't part of the renderer's compilation
  // unit. The renderer never sees signing material or a raw
  // isLicensed boolean it could set itself -- only the result of a
  // main-process verification call.

  type LicenseType = "trial" | "standard" | "professional" | "enterprise";

  type LicenseCheckStatus =
    | "valid"
    | "not_activated"
    | "invalid_format"
    | "invalid_signature"
    | "unknown_key"
    | "wrong_product"
    | "wrong_machine"
    | "expired"
    | "revoked"
    | "trial";

  interface LicenseStatusView {

    activated: boolean;

    status: LicenseCheckStatus;

    reason?: string;

    licenseId?: string;

    customerName?: string;

    companyName?: string;

    licenseType?: LicenseType;

    expirationDate?: string | null;

    trialExpiresAt?: string;

  }

  interface RevocationImportResult {

    accepted: boolean;

    reason?: string;

    addedCount?: number;

  }

  interface RevocationStatusView {

    lastImportedAt: string | null;

    count: number;

  }



  // ===============================
  // AUTHENTICATION
  // ===============================
  //
  // Mirrors src/repositories/user-repository.ts's SafeUser (password
  // hash stripped) -- same reasoning as the LICENSE types above:
  // duplicated here because the repository lives outside the
  // renderer's compilation unit.

  type UserType = "owner" | "administrator" | "employee";

  type UserStatus = "active" | "disabled" | "archived";

  interface SafeUser {

    id: number;

    user_type: UserType;

    username: string;

    must_change_password: number;

    status: UserStatus;

    employee_id: number | null;

    permission_profile_id: number | null;

    created_by: number | null;

    failed_login_attempts: number;

    locked_until: string | null;

    last_login_at: string | null;

    created_at: string;

    updated_at: string;

    full_name: string | null;

    email: string | null;

    phone: string | null;

    designation: string | null;

  }

  interface AuthResult {

    success: boolean;

    user?: SafeUser;

    error?: string;

    recoveryKey?: string;

  }

  type PasswordResetRequestStatus = "pending" | "approved" | "completed" | "cancelled" | "expired";

  type PasswordResetRequestUserType = "employee" | "administrator";

  type PasswordResetRequestType = "password" | "username";

  interface PasswordResetRequestRecord {

    id: number;

    user_id: number;

    user_type: PasswordResetRequestUserType;

    status: PasswordResetRequestStatus;

    request_type: PasswordResetRequestType;

    reset_code_hash: string | null;

    // Unix timestamp (seconds since epoch), not an ISO string -- see
    // password-reset-repository.ts.
    reset_code_expires_at: number | null;

    reset_code_used_at: string | null;

    reviewed_by: number | null;

    created_at: string;

    resolved_at: string | null;

    username: string;

    full_name: string | null;

    reviewed_by_username: string | null;

    reviewed_by_full_name: string | null;

  }

  type MessageCategory = "general" | "account_recovery";

  interface MessageRecord {

    id: number;

    sender_id: number | null;

    sender_name: string;

    recipient_id: number;

    recipient_name: string;

    subject: string;

    body: string;

    category: MessageCategory;

    parent_message_id: number | null;

    is_read: number;

    deleted_by_sender: number;

    deleted_by_recipient: number;

    created_at: string;

    updated_at: string;

  }

  interface MessageableRecipient {

    id: number;

    full_name: string;

    username: string;

    user_type: string;

  }

  type PasswordResetAuditEvent = "requested" | "approved" | "completed" | "expired" | "cancelled";

  interface PasswordResetAuditLogRecord {

    id: number;

    request_id: number;

    event: PasswordResetAuditEvent;

    actor_user_id: number | null;

    detail: string | null;

    created_at: string;

  }

  type BusinessMode = "starter" | "enterprise";



  interface UserWithEmployee extends SafeUser {

    employee_first_name: string | null;

    employee_last_name: string | null;

    employee_number: string | null;

    employee_department: string | null;

    employee_designation: string | null;

    permission_profile_name: string | null;

  }

  interface PermissionProfileWithKeys {

    id: number;

    name: string;

    description: string;

    is_system: number;

    created_at: string;

    updated_at: string;

    permissionKeys: string[];

  }

  interface AuditLogEntry {

    id: number;

    user_id: number | null;

    username: string | null;

    user_type: string | null;

    module: string;

    action: string;

    record_id: string | null;

    record_label: string | null;

    old_value: string | null;

    new_value: string | null;

    created_at: string;

  }

  interface CreateUserResult {

    success: boolean;

    user?: SafeUser;

    temporaryPassword?: string;

    error?: string;

  }

  interface SecurityPolicy {

    maxLoginAttempts: number;

    lockoutMinutes: number;

    sessionTimeoutMinutes: number;

  }

  interface ActiveSessionRecord {

    id: number;

    user_id: number;

    username: string;

    user_type: string;

    remember_me: number;

    expires_at: string | null;

    created_at: string;

    last_used_at: string;

  }

  interface ExportedDataset {

    formatVersion: 1;

    exportedAt: string;

    tables: Record<string, Record<string, unknown>[]>;

  }

  interface ImportSummary {

    success: boolean;

    error?: string;

    imported?: Record<string, number>;

    skipped?: Record<string, number>;

  }

  interface ResetResult {

    success: boolean;

    error?: string;

  }

  /** What the reset panel shows before anything is deleted: the real local
   *  row counts, whether cloud sync is configured/reachable, and the current
   *  central reset epoch. */
  interface ResetPreview {

    cloudEnabled: boolean;

    workspaceId: string;

    resetEpoch: number;

    cloudReachable: boolean;

    cloudError?: string;

    serverOutdated?: boolean;

    localCounts: Record<string, number>;

    tables: string[];

    note: string;

  }

  interface ResetOutcome {

    success: boolean;

    error?: string;

    backupPath?: string;

    resetEpoch?: number;

    deleted?: Record<string, number>;

  }



  interface Window {


    mooral: {


      products: {


        getAll(): Promise<Product[]>;


        create(product: Omit<Product,"product_id">): Promise<any>;


        update(data:{
          id:number;
          product:Omit<Product,"product_id">;
        }): Promise<any>;


        delete(id:number): Promise<any>;


      };







      customers: {


        getAll(): Promise<Customer[]>;


        create(customer:Omit<Customer,"customer_id">): Promise<any>;


        update(data:{
          id:number;
          customer:Omit<Customer,"customer_id">;
        }): Promise<any>;


        delete(id:number): Promise<any>;


      };








      orders: {


        getAll(): Promise<Order[]>;


        create(order: OrderCreateInput | Order): Promise<any>;


        update(data:{
          id:number;
          order:Order;
        }): Promise<any>;


        delete(id:number): Promise<any>;


      };








      inventory: {


        getAll(filters?: {
          fromDate?: string;
          toDate?: string;
        }): Promise<InventoryTransaction[]>;


        stockIn(data:{
          product_id:string;
          quantity:number;
          note?:string;
        }): Promise<any>;



        stockOut(data:{
          product_id:string;
          quantity:number;
          note?:string;
        }): Promise<any>;


      };




      invoices: {


        getAll(filters?: {
          search?: string;
          status?: string;
          fromDate?: string;
          toDate?: string;
        }): Promise<Invoice[]>;


        getById(id: number): Promise<Invoice | undefined>;


        summary(): Promise<InvoiceSummary>;


        update(data:{
          id: number;
          invoice: Omit<Invoice, "invoice_id" | "id">;
        }): Promise<any>;


        delete(id: number): Promise<any>;


        exportPdf(data:{
          html: string;
          fileName: string;
        }): Promise<{ success: boolean; filePath?: string; cancelled?: boolean; error?: string }>;


      };


      certificates: {


        getAll(filters?: {
          search?: string;
          category?: "Employee" | "Product" | "All";
          status?: string;
          fromDate?: string;
          toDate?: string;
        }): Promise<Certificate[]>;


        getById(id: number): Promise<Certificate | undefined>;


        summary(): Promise<any>;


        create(certificate: Omit<Certificate, "certificate_id" | "id">): Promise<any>;


        update(data:{
          id: number;
          certificate: Omit<Certificate, "certificate_id" | "id" | "certificate_category">;
        }): Promise<any>;


        delete(id: number): Promise<any>;


        markPrinted(id: number): Promise<any>;


        exportPdf(data:{
          html: string;
          fileName: string;
        }): Promise<{ success: boolean; filePath?: string; cancelled?: boolean; error?: string }>;


      };


employees: {


    getAll(filters?: {
      search?: string;
      department?: string;
      status?: string;
    }): Promise<Employee[]>;


    getById(id: number): Promise<Employee | undefined>;


    create(employee: Omit<Employee, "employee_number" | "id" | "has_photo"> & { photo_data_url?: string | null }): Promise<{ id: number; employee_number: string }>;


    update(data:{
      id: number;
      employee: Omit<Employee, "employee_number" | "id" | "has_photo"> & { photo_data_url?: string | null; remove_photo?: boolean };
    }): Promise<any>;


    delete(id: number): Promise<any>;


    pickPhoto(): Promise<{ dataUrl: string; mime: string } | null>;


    getPhotoPreview(id: number): Promise<string | null>;


};


employeeContracts: {

    getByEmployee(employeeId: number): Promise<EmployeeContract[]>;

    getCurrent(employeeId: number): Promise<EmployeeContract | undefined>;

    create(data: {
        employee_id: number;
        contract_start_date: string;
        contract_end_date?: string | null;
    }): Promise<EmployeeContract>;

    extend(data: {
        contract_id: number;
        contract_end_date: string;
        extension_reason: string;
    }): Promise<EmployeeContract>;

};


accounting: {

    get(filters?: {
        fromDate?: string;
        toDate?: string;
    }): Promise<Transaction[]>;

    summary(filters?: {
        fromDate?: string;
        toDate?: string;
    }): Promise<{
        totalTransactions: number;
        totalIncome: number;
        totalExpense: number;
        balance: number;
    }>;

    create(transaction: Omit<Transaction,"transaction_id">): Promise<any>;

    update(
        id: number,
        transaction: Omit<Transaction,"transaction_id">
    ): Promise<any>;

    delete(id: number): Promise<any>;

};


ledger: {

    accounts(): Promise<Account[]>;

    accountSummary(): Promise<AccountSummaryRow[]>;

    customerLedger(filters: {
        customerId: string;
        fromDate?: string;
        toDate?: string;
    }): Promise<LedgerEntry[]>;

    customersWithActivity(): Promise<{ customer_id: string; customer_name: string }[]>;

    generalLedger(filters?: {
        accountId?: number;
        fromDate?: string;
        toDate?: string;
    }): Promise<LedgerEntry[]>;

};

journal: {

    get(filters?: {
        fromDate?: string;
        toDate?: string;
    }): Promise<JournalEntry[]>;

    create(data: {
        entry_date: string;
        debit_account_id: number;
        credit_account_id: number;
        amount: number;
        reference?: string;
        description: string;
    }): Promise<JournalEntry>;

};


notifications: {

    get(): Promise<AppNotification[]>;

    create(notification: {
        module: string;
        action: string;
        message: string;
        user?: string;
        before?: string | null;
        after?: string | null;
    }): Promise<any>;

    delete(id: number): Promise<any>;

    reset(): Promise<any>;

};


settings: {

    get(): Promise<any>;

    save(settings:any): Promise<any>;

    selectLogo(): Promise<string | null>;

    getLogoPreview(
      logoPath?:string
    ): Promise<string | null>;

    uploadLogo(): Promise<string | null>;

    /** Saves a logo the user reviewed and approved in the renderer. */
    saveLogo(dataUrl:string): Promise<string | null>;

    removeLogo(): Promise<{ success: boolean }>;

};


database: {

    getInfo(): Promise<DatabaseInfo>;

    backup(): Promise<DatabaseBackupResult>;

    restore(): Promise<DatabaseRestoreResult>;

    vacuum(): Promise<{ success: boolean; error?: string }>;

    checkIntegrity(): Promise<DatabaseIntegrityResult>;

};


app: {

    getInfo(): Promise<AppInfo>;

};


appPreferences: {

    get(): Promise<{ automaticUpdateChecks: boolean; launchOnStartup: boolean; crashErrorReporting: boolean }>;

    set(key: "automaticUpdateChecks" | "launchOnStartup" | "crashErrorReporting", value: boolean): Promise<{ automaticUpdateChecks: boolean; launchOnStartup: boolean; crashErrorReporting: boolean }>;

    checkForUpdatesNow(): Promise<{ currentVersion: string; updateAvailable: false; message: string }>;

};


license: {

    getMachineId(): Promise<string>;

    activate(licenseKey: string): Promise<LicenseStatusView>;

    activateCompact(activationCode: string, licenseFileText: string): Promise<LicenseStatusView>;

    getSupportConfig(): Promise<{ whatsappNumber: string; email: string }>;

    saveSupportConfig(data: { whatsappNumber: string; email: string }): Promise<{ whatsappNumber: string; email: string }>;

    saveActivationRequest(): Promise<{ success: boolean; canceled?: boolean; filePath?: string; requestId?: string }>;

    requestViaWhatsApp(): Promise<{ success: boolean; requestId: string }>;

    requestViaEmail(): Promise<{ success: boolean; requestId: string }>;

    deactivate(): Promise<{ success: boolean }>;

    getStatus(): Promise<LicenseStatusView>;

    getTrialProfile(): Promise<{
      ownerFullName: string;
      companyName: string;
      email: string;
      phone: string;
      machineId: string;
      requestId: string;
      savedAt: string;
    } | null>;

    saveTrialProfile(data: {
      ownerFullName: string;
      companyName: string;
      email: string;
      phone: string;
    }): Promise<{
      ownerFullName: string;
      companyName: string;
      email: string;
      phone: string;
      machineId: string;
      requestId: string;
      savedAt: string;
    }>;

    activateTrial(data: {
      ownerFullName: string;
      companyName: string;
      email: string;
      phone: string;
    }): Promise<{
      success: boolean;
      reason?: string;
      expiresAt?: string;
      profile?: any;
    }>;

    getTrialStatus(): Promise<{
      active: boolean;
      used: boolean;
      expiresAt?: string;
      profile?: any;
    }>;

    importRevocationBundle(bundleJson: string): Promise<RevocationImportResult>;

    getRevocationStatus(): Promise<RevocationStatusView>;

};


auth: {

    checkSetupRequired(): Promise<boolean>;

    setupOwner(data: { username: string; password: string }): Promise<AuthResult>;

    login(data: { username: string; password: string; rememberMe: boolean }): Promise<AuthResult>;

    logout(): Promise<{ success: boolean }>;

    restoreSession(): Promise<{ user: SafeUser } | null>;

    getCurrentUser(): Promise<SafeUser | null>;

    changePassword(data: { currentPassword: string; newPassword: string }): Promise<AuthResult>;

    getMyPermissions(): Promise<string[] | null>;

    updateProfile(data: { username: string; fullName?: string; email?: string; phone?: string; designation?: string }): Promise<AuthResult>;

    getMyProfilePhoto(): Promise<string | null>;

    pickProfilePhoto(): Promise<{ dataUrl: string; mime: string } | null>;

    saveProfilePhoto(data: { photoDataUrl: string }): Promise<{ success: boolean }>;

    removeProfilePhoto(): Promise<{ success: boolean }>;

};


passwordReset: {

    request(data: { identityNumber: string; dateOfBirth: string; employeeId: string }): Promise<{ success: boolean; error?: string }>;

    requestUsername(data: { identityNumber: string; dateOfBirth: string; employeeId: string }): Promise<{ success: boolean; error?: string }>;

    approveUsername(requestId: number): Promise<{ success: boolean; error?: string }>;

    listPending(): Promise<PasswordResetRequestRecord[]>;

    listHistory(): Promise<PasswordResetRequestRecord[]>;

    auditLog(requestId: number): Promise<PasswordResetAuditLogRecord[]>;

    generateCode(requestId: number): Promise<{ success: boolean; resetCode?: string; error?: string }>;

    redeem(data: { username: string; resetCode: string; newPassword: string }): Promise<AuthResult>;

    verifyOwnerRecoveryKey(data: { username: string; recoveryKey: string }): Promise<{ success: boolean; error?: string }>;

    resetOwnerWithRecoveryKey(data: { username: string; recoveryKey: string; newPassword: string }): Promise<AuthResult>;

};


messages: {

    listRecipients(): Promise<MessageableRecipient[]>;

    inbox(): Promise<MessageRecord[]>;

    sent(): Promise<MessageRecord[]>;

    unreadCount(): Promise<number>;

    open(id: number): Promise<MessageRecord | null>;

    send(data: { recipientId: number; subject: string; body: string }): Promise<{ success: boolean; message?: MessageRecord; error?: string }>;

    reply(data: { messageId: number; body: string }): Promise<{ success: boolean; message?: MessageRecord; error?: string }>;

    edit(data: { messageId: number; subject: string; body: string }): Promise<{ success: boolean; error?: string }>;

    delete(messageId: number): Promise<{ success: boolean }>;

};


businessMode: {

    get(): Promise<BusinessMode>;

};


securityPolicy: {

    get(): Promise<SecurityPolicy>;

    set(policy: SecurityPolicy): Promise<{ success: boolean }>;

};


sessions: {

    list(): Promise<ActiveSessionRecord[]>;

    revoke(sessionId: number): Promise<{ success: boolean }>;

};


dataTransfer: {

    export(): Promise<{ success: boolean; filePath?: string; cancelled?: boolean; error?: string }>;

    import(): Promise<ImportSummary & { cancelled?: boolean }>;

};


erpControl: {

    reset(): Promise<ResetResult>;

    factoryReset(): Promise<ResetResult>;

    preview(): Promise<ResetPreview>;

    local(data: { password: string }): Promise<ResetResult>;

    cloud(data: { password: string; confirmWorkspace: string }): Promise<ResetOutcome>;

    complete(data: { password: string; confirmation: string }): Promise<ResetOutcome>;

};


users: {

    list(): Promise<UserWithEmployee[]>;

    employeesAvailableForLogin(): Promise<Employee[]>;

    createAdministrator(): Promise<CreateUserResult>;

    createEmployeeLogin(data: { employeeId: number; permissionProfileId: number }): Promise<CreateUserResult>;

    disable(userId: number): Promise<{ success: boolean }>;

    archive(userId: number): Promise<{ success: boolean }>;

    restore(userId: number): Promise<{ success: boolean }>;

    resetPassword(userId: number): Promise<CreateUserResult>;

    changePermissionProfile(data: { userId: number; permissionProfileId: number }): Promise<{ success: true } | { success: false; error: string }>;

};


credentials: {

    exportPdf(data: { html: string; fileName: string }): Promise<{ success: boolean; filePath?: string; cancelled?: boolean; error?: string }>;

};


reports: {

    exportPdf(data: { html: string; fileName: string }): Promise<{ success: boolean; filePath?: string; cancelled?: boolean; error?: string }>;

};


permissionProfiles: {

    list(): Promise<PermissionProfileWithKeys[]>;

    create(data: { name: string; description: string; permissionKeys: string[] }): Promise<PermissionProfileWithKeys>;

    update(data: { id: number; name: string; description: string; permissionKeys: string[] }): Promise<PermissionProfileWithKeys>;

    delete(id: number): Promise<{ success: boolean }>;

};


auditLog: {

    list(filter?: {
        module?: string;
        userId?: number;
        action?: string;
        fromDate?: string;
        toDate?: string;
        search?: string;
    }): Promise<AuditLogEntry[]>;

    export(filter?: {
        module?: string;
        userId?: number;
        action?: string;
        fromDate?: string;
        toDate?: string;
        search?: string;
    }): Promise<AuditLogEntry[]>;

};


cloud: {
  // mode "developer_managed": apiUrl/workspaceId are shown read-only,
  // apiKey never crosses IPC (apiKeyMasked only), saveConfig can only
  // change the local enabled toggle.
  // mode "customer_managed": the license grants the entitlement only --
  // apiUrl/workspaceId/apiKey here are the customer's own, editable
  // values (persisted locally, never part of the license); save them
  // with saveCustomerConfig.
  getConfig(): Promise<{ enabled: boolean; licensed: boolean; mode: "developer_managed" | "customer_managed"; apiUrl: string; workspaceId: string; apiKey: string; apiKeyMasked: string }>;
  saveConfig(config: { enabled: boolean }): Promise<{ enabled: boolean; licensed: boolean; mode: "developer_managed" | "customer_managed"; apiUrl: string; workspaceId: string; apiKey: string; apiKeyMasked: string }>;
  // Only succeeds when the active license's mode is "customer_managed".
  saveCustomerConfig(config: { apiUrl: string; workspaceId: string; apiKey: string }): Promise<{ enabled: boolean; licensed: boolean; mode: "developer_managed" | "customer_managed"; apiUrl: string; workspaceId: string; apiKey: string; apiKeyMasked: string }>;
  health(): Promise<{ success: boolean; status?: number; detail?: string }>;
  syncNow(): Promise<{ success: boolean; error?: string }>;
  /** Read-only snapshot for the Settings status panel: read from the file the
   *  sync loop writes at the end of every cycle plus the persisted reset epoch,
   *  so it never performs a network call. `null` = never happened yet. */
  getStatus(): Promise<{
    lastSyncAt: string | null;
    permissionsSynced: boolean | null;
    permissionsError: string | null;
    resetEpoch: number;
    enabled: boolean;
    workspaceId: string;
  }>;
},


printPreview: {

    create(html: string, documentLabel?: string): Promise<{ success: boolean; error?: string }>;

    /**
     * Prints the isolated print target created by the main process.
     * Returns whether the native print flow was actually invoked --
     * not whether the user completed/cancelled the interactive dialog,
     * since Electron has no callback for that. `settings`, when
     * provided, is forwarded onto Electron's own webContents.print()
     * options (see the "print-preview:print" handler in
     * electron/main/main.ts) -- every field is a real, documented
     * print() capability.
     */
    print(settings?: {
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
    }): Promise<{ success: boolean; error?: string }>;

    /** Real printer list from Electron's getPrintersAsync(). */
    getPrinters(): Promise<Array<{
        name: string;
        displayName: string;
        isDefault: boolean;
    }>>;

    /** Opens the OS printer settings. Windows-only; see preload.ts. */
    openPrinterSettings(): Promise<{ success: boolean; error?: string }>;
    /** Opens the Windows printer-installation page so the customer can add a printer. */
    addPrinter(): Promise<{ success: boolean; error?: string }>;

};


    };


  }

}