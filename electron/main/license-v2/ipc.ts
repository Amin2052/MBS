import { ipcMain, dialog, shell, app } from "electron";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ConfigManager } from "../config";
import { licenseManagerV2 } from "./license-manager";
import { getTrialProfile, saveTrialProfile, startTrial, getTrialStatus } from "./storage/trial-storage";

// ===================================================================
// License IPC (v2)
//
// Every handler validates its own inputs and delegates immediately to
// LicenseManagerV2 — no license logic lives in this file, and nothing
// here ever returns a bare boolean the renderer could spoof by
// skipping the call. Owner-only gating is applied to license:activate,
// license:deactivate, and license:importRevocationBundle, all
// reachable only from inside the authenticated app (Settings >
// License), where a session exists.
//
// IMPORTANT: the guard passed in here MUST be
// requireUserTypeAllowUnlicensed (see auth/authorization.ts), NOT the
// regular requireUserType. Regular requireUserType now also requires
// an active license/trial (audit fix #1) -- if these three handlers
// used it, an Owner whose license just expired or was revoked would
// be locked out of the very screen that lets them install a new one.
// license:activateCompact is deliberately NOT gated at all: it is only
// ever called from license-gate.tsx, which renders outside
// AuthProvider/AuthGate in main.tsx (LicenseGate wraps them) - no
// session can exist yet at that point. Call registerLicenseIpcV2 after
// the guard is available.
// ===================================================================

export function registerLicenseIpcV2(
  requireUserType: (type: "owner") => void
): void {

  ipcMain.handle("license:getMachineId", () => {
    return licenseManagerV2.getMachineId();
  });

  ipcMain.handle("license:getStatus", () => {
    return licenseManagerV2.getStatus();
  });

  ipcMain.handle("license:getTrialProfile", () => {
    return getTrialProfile();
  });

  ipcMain.handle("license:saveTrialProfile", (_event, data) => {
    if (!data || typeof data.ownerFullName !== "string" || typeof data.companyName !== "string" ||
        typeof data.email !== "string" || typeof data.phone !== "string") {
      throw new Error("Full name, company name, email, and phone number are required.");
    }
    const ownerFullName = data.ownerFullName.trim();
    const companyName = data.companyName.trim();
    const email = data.email.trim();
    const phone = data.phone.trim();
    if (!ownerFullName || !companyName || !email || !phone) {
      throw new Error("All activation details are required.");
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error("Enter a valid personal email address.");
    }
    if (!/^[+()\d\s-]{7,25}$/.test(phone)) {
      throw new Error("Enter a valid phone number.");
    }
    return saveTrialProfile({ ownerFullName, companyName, email, phone });
  });

  ipcMain.handle("license:activateTrial", (_event, data) => {
    if (!data || typeof data.ownerFullName !== "string" || typeof data.companyName !== "string" ||
        typeof data.email !== "string" || typeof data.phone !== "string") {
      throw new Error("Full name, company name, email, and phone number are required.");
    }
    const ownerFullName = data.ownerFullName.trim();
    const companyName = data.companyName.trim();
    const email = data.email.trim();
    const phone = data.phone.trim();
    if (!ownerFullName || !companyName || !email || !phone) {
      throw new Error("All activation details are required.");
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error("Enter a valid personal email address.");
    }
    if (!/^[+()\d\s-]{7,25}$/.test(phone)) {
      throw new Error("Enter a valid phone number.");
    }
    return startTrial({ ownerFullName, companyName, email, phone });
  });

  ipcMain.handle("license:getTrialStatus", () => getTrialStatus());

  ipcMain.handle("license:activateCompact", (_event, activationCode: string, licenseFileText: string) => {

    // No requireUserType("owner") here: this handler is only ever invoked
    // from license-gate.tsx, which renders *outside* AuthProvider/AuthGate
    // in main.tsx's component tree (LicenseGate wraps AuthProvider). No
    // session can exist in the main process at this point in the app's
    // lifecycle - there is no signed-in user yet to require, on first
    // activation or any later re-activation through this same screen.
    // Post-login license actions (deactivate, importRevocationBundle,
    // both reachable from the authenticated Settings > License page)
    // keep their requireUserType("owner") guard below unchanged.

    if (typeof activationCode !== "string" || typeof licenseFileText !== "string") {
      throw new Error("Activation data is required.");
    }
    if (activationCode.length > 100 || licenseFileText.length > 500_000) {
      throw new Error("Activation data is too large.");
    }

    return licenseManagerV2.activateCompact(activationCode.trim(), licenseFileText);
  });

  ipcMain.handle("license:getSupportConfig", () => {
    const c = ConfigManager.load();
    return { whatsappNumber: c.supportWhatsAppNumber, email: c.supportEmail };
  });

  // Activation Support Contacts are read-only in this build: they are
  // fixed reference contact details, not user-editable data. The
  // handler intentionally rejects writes rather than persisting them,
  // so no UI or direct API call can modify these values.
  ipcMain.handle("license:saveSupportConfig", () => {
    throw new Error("Support contacts are read-only and cannot be modified.");
  });

  ipcMain.handle("license:saveActivationRequest", async () => {
    const machineId = licenseManagerV2.getMachineId();
    const profile = getTrialProfile();
    const requestId = profile?.requestId ?? `REQ-${new Date().getFullYear()}-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
    const content = JSON.stringify({
      product: "Mooral Business Suite", requestId,
      customerName: profile?.ownerFullName ?? "", companyName: profile?.companyName ?? "",
      email: profile?.email ?? "", phone: profile?.phone ?? "", machineId
    }, null, 2);
    const result = await dialog.showSaveDialog({
      title: "Save MBS Activation Request",
      defaultPath: path.join(app.getPath("documents"), `${requestId}.mbsrequest`),
      filters: [{ name: "MBS Activation Request", extensions: ["mbsrequest", "json"] }]
    });
    if (result.canceled || !result.filePath) return { success: false, canceled: true };
    fs.writeFileSync(result.filePath, content, "utf8");
    return { success: true, filePath: result.filePath, requestId };
  });

  ipcMain.handle("license:requestViaWhatsApp", async () => {
    const c = ConfigManager.load();
    const number = (c.supportWhatsAppNumber ?? "").replace(/\D/g, "");
    if (!number) throw new Error("Support WhatsApp number is not configured.");
    const machineId = licenseManagerV2.getMachineId();
    const profile = getTrialProfile();
    const requestId = profile?.requestId ?? `REQ-${new Date().getFullYear()}-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
    const message = [
      "Mooral Business Suite Activation Request", "",
      `Owner Full Name: ${profile?.ownerFullName ?? ""}`,
      `Company Name: ${profile?.companyName ?? ""}`,
      `Personal Email: ${profile?.email ?? ""}`,
      `Phone Number: ${profile?.phone ?? ""}`,
      `Machine ID: ${machineId}`,
      "Product: Mooral Business Suite", `Request ID: ${requestId}`, "",
      "Please provide an activation code for this machine."
    ].join("\n");
    await shell.openExternal(`https://wa.me/${number}?text=${encodeURIComponent(message)}`);
    return { success: true, requestId };
  });

  ipcMain.handle("license:requestViaEmail", async () => {
    const c = ConfigManager.load();
    const email = (c.supportEmail ?? "").trim();
    if (!email) throw new Error("Support email is not configured.");
    const machineId = licenseManagerV2.getMachineId();
    const profile = getTrialProfile();
    const requestId = profile?.requestId ?? `REQ-${new Date().getFullYear()}-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
    const subject = "Mooral Business Suite Activation Request";
    const body = [
      "Mooral Business Suite Activation Request", "",
      `Owner Full Name: ${profile?.ownerFullName ?? ""}`,
      `Company Name: ${profile?.companyName ?? ""}`,
      `Personal Email: ${profile?.email ?? ""}`,
      `Phone Number: ${profile?.phone ?? ""}`,
      `Machine ID: ${machineId}`,
      "Product: Mooral Business Suite", `Request ID: ${requestId}`, "",
      "Please provide an activation code for this machine."
    ].join("\n");
    await shell.openExternal(`mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`);
    return { success: true, requestId };
  });

  ipcMain.handle("license:activate", (_event, licenseKey: string) => {

    requireUserType("owner");

    if (!licenseKey || typeof licenseKey !== "string" || !licenseKey.trim()) {
      throw new Error("A license key is required.");
    }

    if (licenseKey.length > 20000) {
      throw new Error("The provided license key is not a valid format.");
    }

    return licenseManagerV2.activate(licenseKey.trim());

  });

  ipcMain.handle("license:deactivate", () => {
    requireUserType("owner");
    return licenseManagerV2.deactivate();
  });

  ipcMain.handle("license:importRevocationBundle", (_event, bundleJson: string) => {

    requireUserType("owner");

    if (!bundleJson || typeof bundleJson !== "string") {
      throw new Error("A revocation bundle file is required.");
    }

    if (bundleJson.length > 2_000_000) {
      throw new Error("The provided file is too large to be a valid revocation bundle.");
    }

    return licenseManagerV2.importRevocationBundle(bundleJson);

  });

  ipcMain.handle("license:getRevocationStatus", () => {
    return licenseManagerV2.getRevocationStatus();
  });

}
