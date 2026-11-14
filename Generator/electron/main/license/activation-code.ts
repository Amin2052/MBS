import crypto from "node:crypto";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const LENGTH = 20;

/** Generates a uniformly distributed 20-character customer reference. */
export function generateActivationCode(): string {
  const alphabetSize = ALPHABET.length;
  const limit = 256 - (256 % alphabetSize);
  let raw = "";

  while (raw.length < LENGTH) {
    const bytes = crypto.randomBytes(LENGTH - raw.length);
    for (const byte of bytes) {
      if (byte >= limit) continue;
      raw += ALPHABET[byte % alphabetSize];
      if (raw.length === LENGTH) break;
    }
  }

  return formatActivationCode(raw);
}

export function normalizeActivationCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function formatActivationCode(value: string): string {
  const raw = normalizeActivationCode(value).slice(0, LENGTH);
  return raw.match(/.{1,4}/g)?.join("-") ?? raw;
}
