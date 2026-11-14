export {};

declare global {
  interface Window {
    generator: {
      vault: {
        isInitialized(): Promise<boolean>;
        isUnlocked(): Promise<boolean>;
        setup(password: string): Promise<{ recoveryKey: string }>;
        unlock(password: string): Promise<boolean>;
        verifyRecoveryKey(key: string): Promise<boolean>;
        recover(key: string, newPassword: string): Promise<boolean>;
        lock(): Promise<{ success: boolean }>;
        lockoutStatus(): Promise<{ locked: boolean; retryAfterMs: number }>;
      };
      settings: {
        cloud: {
          get(): Promise<{
            enabled: boolean;
            mode: "developer_managed" | "customer_managed";
            apiUrl: string;
            workspaceId: string;
            apiKey: string;
          }>;
          save(settings: {
            enabled: boolean;
            mode: "developer_managed" | "customer_managed";
            apiUrl: string;
            workspaceId: string;
            apiKey: string;
          }): Promise<{
            enabled: boolean;
            mode: "developer_managed" | "customer_managed";
            apiUrl: string;
            workspaceId: string;
            apiKey: string;
          }>;
        };
      };
      keys: {
        info(): Promise<{ keyId: string; publicKeyBase64: string; environment: "development" | "production" } | null>;
      };
      license: {
        generate(input: any & {
          licensedCloudConfig?: {
            enabled: boolean;
            mode: "developer_managed" | "customer_managed";
            apiUrl: string;
            workspaceId: string;
            apiKey: string;
          };
        }): Promise<{ licenseKey: string; activationCode: string; licenseFile: string; signed: any }>;
        reExport(licenseId: string): Promise<{ licenseKey: string; activationCode: string | null; licenseFile: string | null; signed: any }>;
        replace(licenseId: string, overrides: any, notes?: string): Promise<{ licenseKey: string; activationCode: string; licenseFile: string; signed: any }>;
        renew(licenseId: string, newExpirationDate: string | null, notes?: string): Promise<{ licenseKey: string; activationCode: string; licenseFile: string; signed: any }>;
        revoke(licenseId: string, reason?: string): Promise<{ success: boolean; status: "revoked"; license: any }>;
        list(): Promise<any[]>;
        search(query: string): Promise<any[]>;
        get(licenseId: string): Promise<any>;
        history(licenseId: string): Promise<any[]>;
      };
      dashboard: {
        counts(): Promise<{ total: number; active: number; expired: number; revoked: number }>;
      };
      revocation: {
        exportBundle(): Promise<string>;
      };
      database: {
        backup(): Promise<{ success: boolean; canceled?: boolean; filePath?: string }>;
        restore(confirmation: string): Promise<{ success: boolean; canceled?: boolean; licensesRestored?: number }>;
        reset(confirmation: string): Promise<{ licensesRemoved: number }>;
      };
    };
  }
}
