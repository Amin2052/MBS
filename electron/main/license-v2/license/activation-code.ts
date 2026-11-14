export function normalizeActivationCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function formatActivationCode(value: string): string {
  const raw = normalizeActivationCode(value);
  return raw.match(/.{1,4}/g)?.join("-") ?? "";
}

export function isValidActivationCode(value: string): boolean {
  const raw = normalizeActivationCode(value);
  return raw.length === 20 && /^[A-Z0-9]+$/.test(raw);
}
