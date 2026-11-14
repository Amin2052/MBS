// ===================================================================
// MUST stay byte-for-byte identical to
// mbs/electron/main/license-v2/crypto/verify.ts's canonicalize().
// Any divergence breaks signature compatibility between apps.
// ===================================================================

export function canonicalize(value: unknown): string {

  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }

  const keys = Object.keys(value as Record<string, unknown>).sort();

  const entries = keys.map((key) => {
    const v = (value as Record<string, unknown>)[key];
    return `${JSON.stringify(key)}:${canonicalize(v)}`;
  });

  return `{${entries.join(",")}}`;

}

export function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(canonicalize(value), "utf8");
}
