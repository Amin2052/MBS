export type OnlineRecord = Record<string, unknown>;

export async function fetchOnlineRecords(baseUrl: string, collection: string): Promise<OnlineRecord[]> {
  const url = `${baseUrl.replace(/\/$/, '')}/v1/online/records/${encodeURIComponent(collection)}`;
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Online fetch failed: ${response.status}`);
  const data = await response.json();
  return Array.isArray(data?.records) ? data.records : [];
}

export async function saveOnlineRecords(
  baseUrl: string,
  collection: string,
  records: OnlineRecord[],
): Promise<void> {
  const url = `${baseUrl.replace(/\/$/, '')}/v1/online/records/${encodeURIComponent(collection)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ records }),
  });
  if (!response.ok) throw new Error(`Online save failed: ${response.status}`);
}
