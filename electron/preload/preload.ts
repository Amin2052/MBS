import {
  contextBridge,
  ipcRenderer
} from "electron";



contextBridge.exposeInMainWorld(
  "mooral",
  {


    // ===============================
    // PRODUCTS
    // ===============================

    products: {


      getAll: () =>
        ipcRenderer.invoke(
          "products:get"
        ),



      create: (product:any) =>
        ipcRenderer.invoke(
          "products:create",
          product
        ),



      update: (data:any) =>
        ipcRenderer.invoke(
          "products:update",
          data
        ),



      delete: (id:number) =>
        ipcRenderer.invoke(
          "products:delete",
          id
        )


    },







    // ===============================
    // CUSTOMERS
    // ===============================

    customers: {


      getAll: () =>
        ipcRenderer.invoke(
          "customers:get"
        ),



      create: (customer:any) =>
        ipcRenderer.invoke(
          "customers:create",
          customer
        ),



      update: (data:any) =>
        ipcRenderer.invoke(
          "customers:update",
          data
        ),



      delete: (id:number) =>
        ipcRenderer.invoke(
          "customers:delete",
          id
        )


    },








    // ===============================
    // ORDERS
    // ===============================

    orders: {


      getAll: (
    	filters?: {
        	fromDate?: string;
        	toDate?: string;
        }
    ) =>
    	ipcRenderer.invoke(
               "orders:get",
               filters
        ),



      create: (order:any) =>
        ipcRenderer.invoke(
          "orders:create",
          order
        ),



      update: (data:any) =>
        ipcRenderer.invoke(
          "orders:update",
          data
        ),



      delete: (id:number) =>
        ipcRenderer.invoke(
          "orders:delete",
          id
        )


    },








    // ===============================
    // INVENTORY
    // ===============================

    inventory: {


      getAll: (
        filters?: {
          fromDate?: string;
          toDate?: string;
        }
      ) =>
        ipcRenderer.invoke(
          "inventory:get",
          filters
        ),




      stockIn: (data:any) =>
        ipcRenderer.invoke(
          "inventory:stockIn",
          data
        ),




      stockOut: (data:any) =>
        ipcRenderer.invoke(
          "inventory:stockOut",
          data
        )

    },




    // ===============================
    // INVOICES
    // ===============================

    invoices: {


      getAll: (
        filters?: {
          search?: string;
          status?: string;
          fromDate?: string;
          toDate?: string;
        }
      ) =>
        ipcRenderer.invoke(
          "invoices:get",
          filters
        ),



      getById: (id:number) =>
        ipcRenderer.invoke(
          "invoices:getById",
          id
        ),



      summary: () =>
        ipcRenderer.invoke(
          "invoices:summary"
        ),



      update: (data:any) =>
        ipcRenderer.invoke(
          "invoices:update",
          data
        ),



      delete: (id:number) =>
        ipcRenderer.invoke(
          "invoices:delete",
          id
        ),



      exportPdf: (data:{
        html:string;
        fileName:string;
      }) =>
        ipcRenderer.invoke(
          "invoices:exportPdf",
          data
        )


    }


,
// ===============================
// CERTIFICATES
// ===============================

certificates: {


  getAll: (
    filters?: {
      search?: string;
      category?: string;
      status?: string;
      fromDate?: string;
      toDate?: string;
    }
  ) =>
    ipcRenderer.invoke(
      "certificates:get",
      filters
    ),



  getById: (id:number) =>
    ipcRenderer.invoke(
      "certificates:getById",
      id
    ),



  summary: () =>
    ipcRenderer.invoke(
      "certificates:summary"
    ),



  create: (certificate:any) =>
    ipcRenderer.invoke(
      "certificates:create",
      certificate
    ),



  update: (data:any) =>
    ipcRenderer.invoke(
      "certificates:update",
      data
    ),



  delete: (id:number) =>
    ipcRenderer.invoke(
      "certificates:delete",
      id
    ),



  markPrinted: (id:number) =>
    ipcRenderer.invoke(
      "certificates:markPrinted",
      id
    ),



  exportPdf: (data:{
    html:string;
    fileName:string;
  }) =>
    ipcRenderer.invoke(
      "certificates:exportPdf",
      data
    )


}


,
// ===============================
// EMPLOYEES
// ===============================

employees: {


  getAll: (
    filters?: {
      search?: string;
      department?: string;
      status?: string;
    }
  ) =>
    ipcRenderer.invoke(
      "employees:get",
      filters
    ),



  getById: (id:number) =>
    ipcRenderer.invoke(
      "employees:getById",
      id
    ),



  create: (employee:any) =>
    ipcRenderer.invoke(
      "employees:create",
      employee
    ),



  update: (data:any) =>
    ipcRenderer.invoke(
      "employees:update",
      data
    ),



  delete: (id:number) =>
    ipcRenderer.invoke(
      "employees:delete",
      id
    ),



  pickPhoto: () =>
    ipcRenderer.invoke(
      "employees:pickPhoto"
    ),



  getPhotoPreview: (id:number) =>
    ipcRenderer.invoke(
      "employees:getPhotoPreview",
      id
    )


}

,
// ===============================
// EMPLOYEE CONTRACTS
// ===============================

employeeContracts: {


  getByEmployee: (employeeId:number) =>
    ipcRenderer.invoke(
      "employeeContracts:getByEmployee",
      employeeId
    ),



  getCurrent: (employeeId:number) =>
    ipcRenderer.invoke(
      "employeeContracts:getCurrent",
      employeeId
    ),



  create: (data:{
    employee_id: number;
    contract_start_date: string;
    contract_end_date?: string | null;
  }) =>
    ipcRenderer.invoke(
      "employeeContracts:create",
      data
    ),



  extend: (data:{
    contract_id: number;
    contract_end_date: string;
    extension_reason: string;
  }) =>
    ipcRenderer.invoke(
      "employeeContracts:extend",
      data
    )


}

,
// ===============================
// ACCOUNTING
// ===============================

accounting: {


  get: (
    filters?: {
      fromDate?: string;
      toDate?: string;
    }
  ) =>
    ipcRenderer.invoke(
      "accounting:get",
      filters
    ),


  summary: (
    filters?: {
      fromDate?: string;
      toDate?: string;
    }
  ) =>
    ipcRenderer.invoke(
      "accounting:summary",
      filters
    ),


  create: (transaction:any) =>
    ipcRenderer.invoke(
      "accounting:create",
      transaction
    ),


  update: (
    id:number,
    transaction:any
) =>
    ipcRenderer.invoke(
        "accounting:update",
        {
            id,
            transaction
        }
    ),


  delete: (id:number) =>
    ipcRenderer.invoke(
      "accounting:delete",
      id
    )


}
,
// ===============================
// LEDGER / JOURNAL
// ===============================

ledger: {

  accounts: () =>
    ipcRenderer.invoke(
      "ledger:accounts"
    ),

  accountSummary: () =>
    ipcRenderer.invoke(
      "ledger:accountSummary"
    ),

  customerLedger: (
    filters: {
      customerId: string;
      fromDate?: string;
      toDate?: string;
    }
  ) =>
    ipcRenderer.invoke(
      "ledger:customerLedger",
      filters
    ),

  customersWithActivity: () =>
    ipcRenderer.invoke(
      "ledger:customersWithActivity"
    ),

  generalLedger: (
    filters?: {
      accountId?: number;
      fromDate?: string;
      toDate?: string;
    }
  ) =>
    ipcRenderer.invoke(
      "ledger:generalLedger",
      filters
    )

}
,
journal: {

  get: (
    filters?: {
      fromDate?: string;
      toDate?: string;
    }
  ) =>
    ipcRenderer.invoke(
      "journal:get",
      filters
    ),

  create: (data: {
    entry_date: string;
    debit_account_id: number;
    credit_account_id: number;
    amount: number;
    reference?: string;
    description: string;
  }) =>
    ipcRenderer.invoke(
      "journal:create",
      data
    )

}
,
// ===============================
// NOTIFICATIONS
// ===============================

notifications: {

  get: () =>
    ipcRenderer.invoke(
      "notifications:get"
    ),

  create: (notification: any) =>
    ipcRenderer.invoke(
      "notifications:create",
      notification
    ),

  delete: (id: number) =>
    ipcRenderer.invoke(
      "notifications:delete",
      { id }
    ),

  reset: () =>
    ipcRenderer.invoke(
      "notifications:reset"
    )

}
,
// ===============================
// SETTINGS
// ===============================

settings: {


  get: () =>
    ipcRenderer.invoke(
      "settings:get"
    ),


  save: (settings:any) =>
    ipcRenderer.invoke(
      "settings:save",
      settings
    ),


  selectLogo: () =>
    ipcRenderer.invoke(
      "settings:selectLogo"
    ),


  getLogoPreview: (logoPath?:string) =>
    ipcRenderer.invoke(
      "settings:getLogoPreview",
      logoPath
    ),


  uploadLogo: () =>
    ipcRenderer.invoke(
      "settings:uploadLogo"
    ),


  saveLogo: (dataUrl:string) =>
    ipcRenderer.invoke(
      "settings:saveLogo",
      dataUrl
    ),


  removeLogo: () =>
    ipcRenderer.invoke(
      "settings:removeLogo"
    )


},

// ===============================
// DATABASE (BACKUP & RESTORE)
// ===============================

database: {


  getInfo: () =>
    ipcRenderer.invoke(
      "database:getInfo"
    ),


  backup: () =>
    ipcRenderer.invoke(
      "database:backup"
    ),


  restore: () =>
    ipcRenderer.invoke(
      "database:restore"
    ),


  vacuum: () =>
    ipcRenderer.invoke(
      "database:vacuum"
    ),


  checkIntegrity: () =>
    ipcRenderer.invoke(
      "database:checkIntegrity"
    )


},

// ===============================
// APP INFO (About / System Settings)
// ===============================

app: {


  getInfo: () =>
    ipcRenderer.invoke(
      "app:getInfo"
    )


},

// ===============================
// APP PREFERENCES (About page — Requirement 31)
// ===============================

appPreferences: {

  get: () =>
    ipcRenderer.invoke(
      "appPreferences:get"
    ),

  set: (key: string, value: boolean) =>
    ipcRenderer.invoke(
      "appPreferences:set",
      { key, value }
    ),

  checkForUpdatesNow: () =>
    ipcRenderer.invoke(
      "appPreferences:checkForUpdatesNow"
    )

},

// ===============================
// LICENSE (v2)
// ===============================
//
// Minimal, explicit surface. The renderer never gets raw ipcRenderer
// access and never sees anything resembling a signing capability —
// it can only ask "what's my machine id", "activate this key", "what's
// my status", "deactivate", and import/inspect an offline revocation
// bundle.

license: {


  getMachineId: () =>
    ipcRenderer.invoke(
      "license:getMachineId"
    ),


  getTrialProfile: () =>
    ipcRenderer.invoke(
      "license:getTrialProfile"
    ),

  saveTrialProfile: (data:{ownerFullName:string; companyName:string; email:string; phone:string}) =>
    ipcRenderer.invoke(
      "license:saveTrialProfile",
      data
    ),

  activateTrial: (data:{ownerFullName:string; companyName:string; email:string; phone:string}) =>
    ipcRenderer.invoke(
      "license:activateTrial",
      data
    ),

  getTrialStatus: () =>
    ipcRenderer.invoke(
      "license:getTrialStatus"
    ),


  activate: (licenseKey:string) =>
    ipcRenderer.invoke(
      "license:activate",
      licenseKey
    ),

  activateCompact: (activationCode:string, activationPackageJson:string) =>
    ipcRenderer.invoke("license:activateCompact", activationCode, activationPackageJson),

  getSupportConfig: () => ipcRenderer.invoke("license:getSupportConfig"),

  saveSupportConfig: (data:{whatsappNumber:string; email:string}) =>
    ipcRenderer.invoke("license:saveSupportConfig", data),

  saveActivationRequest: () => ipcRenderer.invoke("license:saveActivationRequest"),

  requestViaWhatsApp: () => ipcRenderer.invoke("license:requestViaWhatsApp"),

  requestViaEmail: () => ipcRenderer.invoke("license:requestViaEmail"),


  deactivate: () =>
    ipcRenderer.invoke(
      "license:deactivate"
    ),


  getStatus: () =>
    ipcRenderer.invoke(
      "license:getStatus"
    ),


  importRevocationBundle: (bundleJson:string) =>
    ipcRenderer.invoke(
      "license:importRevocationBundle",
      bundleJson
    ),


  getRevocationStatus: () =>
    ipcRenderer.invoke(
      "license:getRevocationStatus"
    )


}

,
// ===============================
// AUTHENTICATION
// ===============================

auth: {


  checkSetupRequired: () =>
    ipcRenderer.invoke(
      "auth:checkSetupRequired"
    ),


  setupOwner: (data:{
    username:string;
    password:string;
  }) =>
    ipcRenderer.invoke(
      "auth:setupOwner",
      data
    ),


  login: (data:{
    username:string;
    password:string;
    rememberMe:boolean;
  }) =>
    ipcRenderer.invoke(
      "auth:login",
      data
    ),


  logout: () =>
    ipcRenderer.invoke(
      "auth:logout"
    ),


  restoreSession: () =>
    ipcRenderer.invoke(
      "auth:restoreSession"
    ),


  getCurrentUser: () =>
    ipcRenderer.invoke(
      "auth:getCurrentUser"
    ),


  changePassword: (data:{
    currentPassword:string;
    newPassword:string;
  }) =>
    ipcRenderer.invoke(
      "auth:changePassword",
      data
    ),


  getMyPermissions: () =>
    ipcRenderer.invoke(
      "auth:getMyPermissions"
    ),


  updateProfile: (data:{
    username:string;
    fullName?:string;
    email?:string;
    phone?:string;
    designation?:string;
  }) =>
    ipcRenderer.invoke(
      "auth:updateProfile",
      data
    ),


  getMyProfilePhoto: () =>
    ipcRenderer.invoke(
      "auth:getMyProfilePhoto"
    ),


  pickProfilePhoto: () =>
    ipcRenderer.invoke(
      "auth:pickProfilePhoto"
    ),


  saveProfilePhoto: (data:{
    photoDataUrl:string;
  }) =>
    ipcRenderer.invoke(
      "auth:saveProfilePhoto",
      data
    ),


  removeProfilePhoto: () =>
    ipcRenderer.invoke(
      "auth:removeProfilePhoto"
    )


}

,
// ===============================
// FORGOT PASSWORD / OFFLINE ACCOUNT RECOVERY WORKFLOW
// ===============================

passwordReset: {


  request: (data:{
    identityNumber:string;
    dateOfBirth:string;
    employeeId:string;
  }) =>
    ipcRenderer.invoke(
      "passwordReset:request",
      data
    ),


  requestUsername: (data:{
    identityNumber:string;
    dateOfBirth:string;
    employeeId:string;
  }) =>
    ipcRenderer.invoke(
      "passwordReset:requestUsername",
      data
    ),


  approveUsername: (requestId:number) =>
    ipcRenderer.invoke(
      "passwordReset:approveUsername",
      requestId
    ),


  listPending: () =>
    ipcRenderer.invoke(
      "passwordReset:listPending"
    ),


  listHistory: () =>
    ipcRenderer.invoke(
      "passwordReset:listHistory"
    ),


  auditLog: (requestId:number) =>
    ipcRenderer.invoke(
      "passwordReset:auditLog",
      requestId
    ),


  generateCode: (requestId:number) =>
    ipcRenderer.invoke(
      "passwordReset:generateCode",
      requestId
    ),


  redeem: (data:{
    username:string;
    resetCode:string;
    newPassword:string;
  }) =>
    ipcRenderer.invoke(
      "passwordReset:redeem",
      data
    ),


  verifyOwnerRecoveryKey: (data:{
    username:string;
    recoveryKey:string;
  }) =>
    ipcRenderer.invoke(
      "passwordReset:verifyOwnerRecoveryKey",
      data
    ),


  resetOwnerWithRecoveryKey: (data:{
    username:string;
    recoveryKey:string;
    newPassword:string;
  }) =>
    ipcRenderer.invoke(
      "passwordReset:resetOwnerWithRecoveryKey",
      data
    )


}

,
// ===============================
// INTERNAL MESSAGES
// ===============================

messages: {


  listRecipients: () =>
    ipcRenderer.invoke(
      "messages:listRecipients"
    ),


  inbox: () =>
    ipcRenderer.invoke(
      "messages:inbox"
    ),


  sent: () =>
    ipcRenderer.invoke(
      "messages:sent"
    ),


  unreadCount: () =>
    ipcRenderer.invoke(
      "messages:unreadCount"
    ),


  open: (id:number) =>
    ipcRenderer.invoke(
      "messages:open",
      { id }
    ),


  send: (data:{
    recipientId:number;
    subject:string;
    body:string;
  }) =>
    ipcRenderer.invoke(
      "messages:send",
      data
    ),


  reply: (data:{
    messageId:number;
    body:string;
  }) =>
    ipcRenderer.invoke(
      "messages:reply",
      data
    ),


  edit: (data:{
    messageId:number;
    subject:string;
    body:string;
  }) =>
    ipcRenderer.invoke(
      "messages:edit",
      data
    ),


  delete: (messageId:number) =>
    ipcRenderer.invoke(
      "messages:delete",
      { messageId }
    )


}

,
// ===============================
// BUSINESS MODE
// ===============================
//
// SECURITY (Phase 5): read-only from the renderer's perspective. There
// is no "set" here -- Business Mode only ever changes by activating a
// different signed license (see the license.* bridge above).

businessMode: {


  get: () =>
    ipcRenderer.invoke(
      "businessMode:get"
    )


}

,
// ===============================
// SECURITY POLICIES
// ===============================

securityPolicy: {


  get: () =>
    ipcRenderer.invoke(
      "securityPolicy:get"
    ),


  set: (policy:{
    maxLoginAttempts:number;
    lockoutMinutes:number;
    sessionTimeoutMinutes:number;
  }) =>
    ipcRenderer.invoke(
      "securityPolicy:set",
      policy
    )


}

,
// ===============================
// ACTIVE SESSIONS
// ===============================

sessions: {


  list: () =>
    ipcRenderer.invoke(
      "sessions:list"
    ),


  revoke: (sessionId:number) =>
    ipcRenderer.invoke(
      "sessions:revoke",
      sessionId
    )


}

,
// ===============================
// DATA IMPORT / EXPORT
// ===============================

dataTransfer: {


  export: () =>
    ipcRenderer.invoke(
      "data:export"
    ),


  import: () =>
    ipcRenderer.invoke(
      "data:import"
    )


}

,
// ===============================
// ERP / FACTORY RESET
// ===============================

erpControl: {


  reset: () =>
    ipcRenderer.invoke(
      "erp:reset"
    ),


  factoryReset: () =>
    ipcRenderer.invoke(
      "erp:factoryReset"
    ),


  // Cloud-aware reset surfaces. All four are Owner-only AND require the
  // owner's password again inside the main process (see main.ts reset:local /
  // reset:cloud / reset:complete), so the renderer can hide the buttons but
  // cannot skip either gate.
  preview: () =>
    ipcRenderer.invoke(
      "reset:preview"
    ),


  local: (data: { password: string }) =>
    ipcRenderer.invoke(
      "reset:local",
      data
    ),


  cloud: (data: { password: string; confirmWorkspace: string }) =>
    ipcRenderer.invoke(
      "reset:cloud",
      data
    ),


  complete: (data: { password: string; confirmation: string }) =>
    ipcRenderer.invoke(
      "reset:complete",
      data
    )


}

,
// ===============================
// USER MANAGEMENT
// ===============================

users: {


  list: () =>
    ipcRenderer.invoke(
      "users:list"
    ),


  employeesAvailableForLogin: () =>
    ipcRenderer.invoke(
      "users:employeesAvailableForLogin"
    ),


  createAdministrator: () =>
    ipcRenderer.invoke(
      "users:createAdministrator"
    ),


  createEmployeeLogin: (data:{
    employeeId:number;
    permissionProfileId:number;
  }) =>
    ipcRenderer.invoke(
      "users:createEmployeeLogin",
      data
    ),


  disable: (userId:number) =>
    ipcRenderer.invoke(
      "users:disable",
      userId
    ),


  archive: (userId:number) =>
    ipcRenderer.invoke(
      "users:archive",
      userId
    ),


  restore: (userId:number) =>
    ipcRenderer.invoke(
      "users:restore",
      userId
    ),


  resetPassword: (userId:number) =>
    ipcRenderer.invoke(
      "users:resetPassword",
      userId
    ),


  changePermissionProfile: (data:{
    userId:number;
    permissionProfileId:number;
  }) =>
    ipcRenderer.invoke(
      "users:changePermissionProfile",
      data
    )


}

,
// ===============================
// CREDENTIALS (Phase 4)
// ===============================

credentials: {


  exportPdf: (data:{
    html:string;
    fileName:string;
  }) =>
    ipcRenderer.invoke(
      "credentials:exportPdf",
      data
    )


}

,
// ===============================
// REPORTS
// ===============================

reports: {


  exportPdf: (data:{
    html:string;
    fileName:string;
  }) =>
    ipcRenderer.invoke(
      "reports:exportPdf",
      data
    )


}

,
// ===============================
// PERMISSION PROFILES
// ===============================

permissionProfiles: {


  list: () =>
    ipcRenderer.invoke(
      "permissionProfiles:list"
    ),


  create: (data:{
    name:string;
    description:string;
    permissionKeys:string[];
  }) =>
    ipcRenderer.invoke(
      "permissionProfiles:create",
      data
    ),


  update: (data:{
    id:number;
    name:string;
    description:string;
    permissionKeys:string[];
  }) =>
    ipcRenderer.invoke(
      "permissionProfiles:update",
      data
    ),


  delete: (id:number) =>
    ipcRenderer.invoke(
      "permissionProfiles:delete",
      id
    )


},


auditLog: {


  list: (filter?:{
    module?:string;
    userId?:number;
    action?:string;
    fromDate?:string;
    toDate?:string;
    search?:string;
  }) =>
    ipcRenderer.invoke(
      "auditLog:list",
      filter ?? {}
    ),


  export: (filter?:{
    module?:string;
    userId?:number;
    action?:string;
    fromDate?:string;
    toDate?:string;
    search?:string;
  }) =>
    ipcRenderer.invoke(
      "auditLog:export",
      filter ?? {}
    )


}

,
// ===============================
// CLOUD / ONLINE DATABASE
// ===============================

cloud: {
  getConfig: () => ipcRenderer.invoke("cloud:getConfig"),
  // apiUrl/workspaceId/apiKey are developer property carried inside the
  // signed license -- only the local enabled/disabled preference can be
  // set from the renderer. See cloud-config-service.ts.
  saveConfig: (config: { enabled: boolean }) =>
    ipcRenderer.invoke("cloud:saveConfig", config),
  // Only accepted by the main process when the active license grants a
  // "customer_managed" cloud entitlement -- see cloud:saveCustomerConfig.
  saveCustomerConfig: (config: { apiUrl: string; workspaceId: string; apiKey: string }) =>
    ipcRenderer.invoke("cloud:saveCustomerConfig", config),
  health: () => ipcRenderer.invoke("cloud:health"),
  syncNow: () => ipcRenderer.invoke("cloud:syncNow"),
  // Read-only status snapshot for the Settings panel (local files only).
  getStatus: () => ipcRenderer.invoke("cloud:getStatus")
  // SECURITY (IPC audit): listRecords/createRecord/updateRecord/
  // deleteRecord were removed here along with their main-process
  // handlers -- see the comment in electron/main/main.ts at the same
  // spot for why (unauthenticated, unused, generic table/record proxy
  // to the tenant's cloud data).
},

// ===============================
// PRINT PREVIEW (Invoices, Certificates, Credentials)
// ===============================
// The renderer owns the user-visible preview. The main process creates the
// isolated print target only after the user confirms Print.

printPreview: {

  create: (html: string, documentLabel?: string) =>
    ipcRenderer.invoke(
      "print-preview:create",
      { html, documentLabel }
    ),


  print: (settings?: {
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
  }) =>
    ipcRenderer.invoke(
      "print-preview:print",
      settings
    ),


  // Real printer list from Electron's own getPrintersAsync() -- not a
  // hand-maintained/fake list. Empty array (rather than throwing) when
  // no print target window is open yet or the platform call fails, so
  // the settings panel can fall back to "system default" cleanly.
  getPrinters: () =>
    ipcRenderer.invoke(
      "print-preview:getPrinters"
    ),


  // Deep-links to the OS printer settings ("Manage printers"). Only
  // has a real, honest destination on Windows (ms-settings:printers);
  // main.ts reports { success:false } elsewhere instead of guessing at
  // a shell command that may not exist on the user's system.
  openPrinterSettings: () =>
    ipcRenderer.invoke(
      "print-preview:openPrinterSettings"
    ),

  addPrinter: () =>
    ipcRenderer.invoke(
      "print-preview:addPrinter"
    )


}

 }

);
