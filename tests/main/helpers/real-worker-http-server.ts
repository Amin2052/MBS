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

  // Node's http server closes idle keep-alive sockets after 5s by default. In
  // these entries the client (undici inside the Electron main process) keeps
  // sockets alive between sync cycles, and a cycle on a CPU-bound run can
  // easily go quiet for longer than that, so the client would pick a socket
  // the server has just dropped and the request fails with ECONNRESET /
  // "fetch failed" -- an artifact of the test server, not of the app or the
  // Worker. Keep sockets open for the life of the entry instead.
  server.keepAliveTimeout = 0;
  server.headersTimeout = 0;

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        // keepAliveTimeout = 0 above means idle sockets are never reaped by
        // the server, so server.close() alone would wait forever for the
        // client's pooled keep-alive sockets (observed as an entry that logs
        // every PASS and then hangs until the runner's bound). Close them
        // explicitly, with a short fallback so a stuck socket can never turn
        // a finished test into a TIMEOUT.
        close: () => new Promise<void>((resolve) => {
          server.closeAllConnections?.();
          const fallback = setTimeout(resolve, 2000);
          server.close(() => { clearTimeout(fallback); resolve(); });
        })
      });
    });
  });
}
