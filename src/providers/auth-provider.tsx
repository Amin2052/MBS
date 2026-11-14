import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren
} from "react";

import {
  checkSetupRequired,
  setupOwner,
  login as loginRequest,
  logout as logoutRequest,
  restoreSession,
  getCurrentUser,
  changePassword as changePasswordRequest,
  updateProfile as updateProfileRequest,
  getBusinessMode,
  getMyPermissions
} from "@/services/auth-service";

import { hasPermission as evaluatePermission } from "@/auth/permission-engine";
import type { PermissionKey } from "@/auth/permission-catalog";

import type { AuthContextValue } from "@/types/auth-context";


export const AuthContext = createContext<AuthContextValue | undefined>(undefined);


export function AuthProvider({ children }: PropsWithChildren): JSX.Element {

  const [loading, setLoading] = useState(true);
  const [setupRequired, setSetupRequired] = useState(false);
  const [user, setUser] = useState<SafeUser | null>(null);
  const [pendingRecoveryKey, setPendingRecoveryKey] = useState<string | null>(null);
  const [businessMode, setBusinessModeState] = useState<BusinessMode | null>(null);
  const [grantedPermissions, setGrantedPermissions] = useState<Set<PermissionKey> | null>(null);


  async function loadPermissionsFor(nextUser: SafeUser | null): Promise<void> {

    if (!nextUser || nextUser.user_type !== "employee") {
      setGrantedPermissions(null);
      return;
    }

    const keys = await getMyPermissions();

    setGrantedPermissions(keys ? new Set(keys as PermissionKey[]) : new Set());

  }


  // Startup bootstrap: is an Owner account already set up? If so,
  // attempt to silently restore a Remember Me session. Runs exactly
  // once, before the rest of the app (via AuthGate) is allowed to
  // render -- same pattern as LicenseProvider's startup validation.
  useEffect(() => {

    let cancelled = false;

    async function bootstrap() {

      try {

        const [needsSetup, mode] = await Promise.all([
          checkSetupRequired(),
          getBusinessMode()
        ]);

        if (cancelled) {
          return;
        }

        setBusinessModeState(mode);

        if (needsSetup) {
          setSetupRequired(true);
          return;
        }

        const restored = await restoreSession();

        if (!cancelled && restored) {
          setUser(restored.user);
          await loadPermissionsFor(restored.user);
        }

      }
      finally {

        if (!cancelled) {
          setLoading(false);
        }

      }

    }

    bootstrap();

    return () => {
      cancelled = true;
    };

  }, []);


  const refreshBusinessMode = useCallback(async () => {

    setBusinessModeState(await getBusinessMode());

  }, []);


  const completeSetup = useCallback(async (username: string, password: string) => {

    const result = await setupOwner(username, password);

    if (result.success && result.user) {
      setUser(result.user);
      setSetupRequired(false);
      // Held back from AuthGate until acknowledgeRecoveryKey() runs --
      // see RecoveryKeyRevealScreen -- so the app can never be entered
      // without the Owner seeing this key at least once.
      setPendingRecoveryKey(result.recoveryKey ?? null);
      await loadPermissionsFor(result.user);
    }

    return { success: result.success, error: result.error, recoveryKey: result.recoveryKey };

  }, []);


  const acknowledgeRecoveryKey = useCallback(() => {

    setPendingRecoveryKey(null);

  }, []);


  const login = useCallback(async (username: string, password: string, rememberMe: boolean) => {

    const result = await loginRequest(username, password, rememberMe);

    if (result.success && result.user) {
      setUser(result.user);
      await loadPermissionsFor(result.user);
    }

    return { success: result.success, error: result.error };

  }, []);


  const logout = useCallback(async () => {

    await logoutRequest();

    setUser(null);
    setGrantedPermissions(null);

  }, []);


  const hasPermission = useCallback((permissionKey: PermissionKey) => {

    if (!user) {
      return false;
    }

    return evaluatePermission(
      { userType: user.user_type, grantedPermissions },
      permissionKey
    );

  }, [user, grantedPermissions]);


  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {

    const result = await changePasswordRequest(currentPassword, newPassword);

    if (result.success && result.user) {
      setUser(result.user);
    }

    return { success: result.success, error: result.error };

  }, []);


  const updateProfile = useCallback(async (data: { username: string; fullName?: string; email?: string; phone?: string; designation?: string }) => {

    const result = await updateProfileRequest(data);

    if (result.success && result.user) {
      setUser(result.user);
    }

    return { success: result.success, error: result.error };

  }, []);


  const refreshSession = useCallback(async () => {

    const nextUser = await getCurrentUser();

    setUser(nextUser);
    await loadPermissionsFor(nextUser);

  }, []);


  const value = useMemo<AuthContextValue>(
    () => ({
      loading,
      setupRequired,
      user,
      pendingRecoveryKey,
      acknowledgeRecoveryKey,
      businessMode,
      refreshBusinessMode,
      completeSetup,
      login,
      logout,
      hasPermission,
      changePassword,
      updateProfile,
      refreshSession
    }),
    [
      loading,
      setupRequired,
      user,
      pendingRecoveryKey,
      acknowledgeRecoveryKey,
      businessMode,
      refreshBusinessMode,
      completeSetup,
      login,
      logout,
      hasPermission,
      changePassword,
      updateProfile,
      refreshSession
    ]
  );


  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );

}
