# MBS License Generator — Final Release

Version: 1.0.0
Production signing key: prod-2026-08

This is a private administrative tool. Never distribute it to customers.

The production private signing key must remain inside the Generator's encrypted vault/userData or an independently secured administrative backup.

## Windows release
Run on Windows or Windows CI:

- `npm install`
- `npm run dist:win`

The portable executable is produced as `dist/MBS-License-Generator.exe`.

## Release status
Source release package finalized. Windows binaries cannot be emitted from this Linux environment; the supplied Windows build script is the authoritative release command.
