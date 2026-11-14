import { app, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";

// ===================================================================
// Remember Me — Secure Local Session Storage
//
// "Remember Me" needs to survive an app restart, which means the
// session token has to live somewhere on disk between launches. It is
// never written in plaintext: Electron's `safeStorage` encrypts it
// using the OS's own credential store (Keychain on macOS, DPAPI on
// Windows, libsecret on Linux), the same class of protection the OS
// itself uses for saved passwords -- this file only ever writes and
// reads the resulting opaque, encrypted buffer.
//
// If OS-level encryption isn't available (e.g. some headless Linux
// setups with no keyring configured), we deliberately do NOT fall
// back to writing the token in plaintext. Remember Me is simply
// unavailable on that machine for that install -- login still works
// normally, it just always asks for credentials again next launch.
// A degraded-but-safe fallback is the correct trade-off; a working
// plaintext credential store on disk is not.
// ===================================================================

function getSessionFilePath(): string {

  return path.join(
    app.getPath("userData"),
    "session.dat"
  );

}

export function isRememberMeAvailable(): boolean {

  return safeStorage.isEncryptionAvailable();

}

export function persistRememberMeToken(token: string): boolean {

  if (!isRememberMeAvailable()) {
    return false;
  }

  try {

    const encrypted = safeStorage.encryptString(token);

    fs.writeFileSync(getSessionFilePath(), encrypted);

    return true;

  }
  catch (error) {

    console.error("Failed to persist Remember Me session:", error);

    return false;

  }

}

export function readRememberMeToken(): string | null {

  const filePath = getSessionFilePath();

  if (!fs.existsSync(filePath)) {
    return null;
  }

  if (!isRememberMeAvailable()) {
    // Encryption key is unavailable (e.g. the OS keyring became
    // inaccessible since the file was written). The stored buffer is
    // unreadable without it -- treat as "no remembered session"
    // rather than throwing, so the user just sees the login screen.
    return null;
  }

  try {

    const encrypted = fs.readFileSync(getSessionFilePath());

    return safeStorage.decryptString(encrypted);

  }
  catch (error) {

    console.error("Failed to read Remember Me session:", error);

    return null;

  }

}

export function clearRememberMeToken(): void {

  const filePath = getSessionFilePath();

  try {

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

  }
  catch (error) {

    console.error("Failed to clear Remember Me session:", error);

  }

}
