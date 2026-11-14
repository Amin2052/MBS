// Wraps the ACTUAL cloudflare/worker/index.js fetch handler as a real,
// listening Node HTTP server backed by the D1 shim (helpers/d1-shim.ts).
// This lets tests point cloud-client.ts's real fetch() calls at a genuine
// http://127.0.0.1:PORT URL and have every request actually go through
// the real Worker's routing, auth, and D1 queries -- not a hand-modeled
// reimplementation of the contract. Used by entry-bidirectional-sync.ts
// (and could replace the hand-rolled mock in other cloud tests over time).
import http from "node:http";

export async function startRealWorkerServer(env: Record<string, unknown>): Promise<{ url: string; close: () => Promise<void> }> {
  const workerModule: any = await import("../../../cloudflare/worker/index.js");
  const handleFetch: (request: Request, env: any) => Promise<Response> = workerModule.default.fetch;

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", async () => {
      try {
        const bodyBuffer = Buffer.concat(chunks);
        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers)) {
          if (value === undefined) continue;
          headers.set(key, Array.isArray(value) ? value.join(",") : value);
        }
        const request = new Request(`http://127.0.0.1${req.url}`, {
          method: req.method,
          headers,
          body: bodyBuffer.length && req.method !== "GET" && req.method !== "HEAD" ? bodyBuffer : undefined
        });
        const response = await handleFetch(request, env);
        const responseBody = Buffer.from(await response.arrayBuffer());
        const outHeaders: Record<string, string> = {};
        response.headers.forEach((value, key) => { outHeaders[key] = value; });
        res.writeHead(response.status, outHeaders);
        res.end(responseBody);
      } catch (error) {
        res.writeHead(500, { "content-type": "text/plain" });
        res.end(String(error instanceof Error ? error.stack || error.message : error));
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}
