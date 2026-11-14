import { useContext } from "react";
import { LicenseContext } from "@/providers/license-provider";

export function useLicense() {
  const ctx = useContext(LicenseContext);
  if (!ctx) throw new Error("useLicense must be used within LicenseProvider");
  return ctx;
}
