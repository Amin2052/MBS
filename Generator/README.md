# MBS License Generator

Private administrative tool. Never distribute to customers.

## Setup
    npm install
    npm run dev

First launch creates the master password vault and a NEW Ed25519 signing
keypair automatically. Development runs create a `dev-YYYY-MM` key; the
Windows production build creates a `prod-YYYY-MM` key. Copy the printed public key (Settings tab)
into MBS's `electron/main/license-v2/keys/trusted-keys.ts` (dev-2026-01
entry) so MBS trusts licenses this Generator signs.

Data (vault, signing key, license database) is stored in this app's
Electron `userData` directory — never in a temp folder.

## Build (Windows portable)
    npm run build
    npm run dist:win

Produces `dist/MBS-License-Generator.exe` (portable, no installer).
Must be run on Windows or a Windows CI runner — this cannot be produced
from a Linux sandbox.

## Production signing key
The `npm run dist:win` build is explicitly marked as a production Generator
and creates a `prod-YYYY-MM` signing key on first launch. Keep that
Generator vault on dedicated secure storage. Copy only the public key from
the Settings screen into MBS `electron/main/license-v2/keys/trusted-keys.ts`
as a new active `prod-YYYY-MM` entry. Never copy or commit the private key.
Keep older public keys as `retired` during key rotation so previously issued
licenses continue to verify. Development `npm run dev` remains isolated with
a `dev-YYYY-MM` key.
