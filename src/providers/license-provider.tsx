import {
  createContext,
  useCallback,
  useEffect,
  useState,
  type PropsWithChildren
} from "react";

interface LicenseContextValue {
  status: Window["mooral"]["license"] extends infer T ? any : any;
  loading: boolean;
  refresh: () => Promise<void>;
  activate: (key: string) => Promise<any>;
  activateCompact: (code: string, licenseFile: string) => Promise<any>;
  deactivate: () => Promise<void>;
}

export const LicenseContext = createContext<LicenseContextValue | undefined>(
  undefined
);

export function LicenseProvider({ children }: PropsWithChildren): JSX.Element {

  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const result = await window.mooral.license.getStatus();
    setStatus(result);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const activate = useCallback(async (key: string) => {
    const result = await window.mooral.license.activate(key);
    setStatus(result);
    return result;
  }, []);

  const activateCompact = useCallback(async (code: string, licenseFile: string) => {
    const result = await window.mooral.license.activateCompact(code, licenseFile);
    setStatus(result);
    return result;
  }, []);

  const deactivate = useCallback(async () => {
    await window.mooral.license.deactivate();
    await refresh();
  }, [refresh]);

  return (
    <LicenseContext.Provider value={{ status, loading, refresh, activate, activateCompact, deactivate }}>
      {children}
    </LicenseContext.Provider>
  );

}
