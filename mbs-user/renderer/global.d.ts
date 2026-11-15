import type { EmployeeSession } from "../shared/api-client";

export type SessionView = Omit<EmployeeSession, "token">;
export type DataRow = Record<string, unknown>;

export interface ConnectionView {
  online: boolean;
  detail: string;
  checkedAt: string;
}

declare global {
  interface Window {
    mbsUser: {
      config: {
        get(): Promise<{ apiUrl: string; workspaceId: string; signedIn: boolean }>;
        set(config: { apiUrl: string; workspaceId: string }): Promise<{ success: boolean; error?: string }>;
      };
      auth: {
        login(input: { username: string; password: string }): Promise<{ success: boolean; error?: string; session?: SessionView | null }>;
        logout(): Promise<{ success: boolean }>;
        refresh(): Promise<{ success: boolean; session: SessionView | null; signedOut: boolean }>;
      };
      data: {
        list(collection: string): Promise<{ success: boolean; error?: string; forbidden?: boolean; offline?: boolean; rows?: DataRow[] }>;
      };
      orders: {
        statuses: string[];
        updateStatus(input: { localId: string; status: string; expectedRevision: number }): Promise<{
          success: boolean;
          error?: string;
          conflict?: boolean;
          offline?: boolean;
          forbidden?: boolean;
          syncRevision?: number;
        }>;
      };
      connection: {
        check(): Promise<ConnectionView>;
      };
      onSessionChanged(callback: (payload: { session: SessionView | null; reason?: string }) => void): () => void;
      onConnectionChanged(callback: (payload: ConnectionView) => void): () => void;
    };
  }
}

export {};
