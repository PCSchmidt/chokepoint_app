/**
 * Application server (CHOKEPOINT-PLAN.md §10.1 "one application process",
 * §10.3 API resources, §16.1 local-first, §9.2 src/server).
 *
 * A small dependency-free node:http server that hosts:
 *   GET /api/health        liveness (§16.1)
 *   GET /api/ready         readiness from the data manager (§16.1)
 *   GET /api/chokepoints   the §4.3 profile registry
 *   GET /api/attribution   §15 attribution records
 *   GET /metrics           Prometheus text exposition (§13.1)
 *   static/*               the built app (dist/) in production
 *
 * The wall clock is read at THIS boundary only (uptime, log timestamps) —
 * domain modules stay deterministic. No credentials pass through the server
 * (§14.1): fixture mode needs none, and the server never proxies provider
 * traffic.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { createDataManager, type DataManager } from "../data/manager";
import { buildHealth, buildReadiness } from "../telemetry/health";
import { MetricsRegistry, type RouteLabel, type StatusLabel } from "../telemetry/metrics";
import { StructuredLogger } from "../telemetry/logger";

export const SERVER_VERSION = "server-v1";

export interface ServerOptions {
  port: number;
  /** Directory of built static assets (default: dist). */
  staticDir?: string | undefined;
  /** Optional registry/logger injection for tests. */
  metrics?: MetricsRegistry | undefined;
  logger?: StructuredLogger | undefined;
}

export interface ChokepointServer {
  port: number;
  close(): Promise<void>;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
  ".map": "application/json",
};

const API_ROUTES: readonly string[] = [
  "/api/health",
  "/api/ready",
  "/api/chokepoints",
  "/api/attribution",
  "/metrics",
];

function statusClass(status: number): StatusLabel {
  if (status < 400) return "2xx";
  if (status < 500) return "4xx";
  return "5xx";
}

function routeLabel(pathname: string): RouteLabel {
  const match = API_ROUTES.find((r) => r === pathname);
  if (match) return match as RouteLabel;
  if (
    pathname.startsWith("/assets/") ||
    pathname.startsWith("/cesium/") ||
    pathname.startsWith("/icons/") ||
    pathname === "/" ||
    pathname === "/index.html"
  ) {
    return "static";
  }
  return "other";
}

/**
 * Serve a static file, or index.html for SPA routes. Path traversal is
 * blocked by normalizing and requiring the result to stay inside staticDir
 * (§14.2).
 */
async function serveStatic(res: ServerResponse, pathname: string, staticDir: string): Promise<boolean> {
  const root = resolve(staticDir);
  const rel = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const filePath = resolve(join(root, rel));
  if (!filePath.startsWith(root)) {
    res.writeHead(403, { "content-type": "text/plain" });
    res.end("forbidden");
    return true;
  }
  let target = filePath;
  try {
    const info = await stat(target);
    if (info.isDirectory()) target = join(target, "index.html");
  } catch {
    target = join(root, "index.html"); // SPA fallback
  }
  try {
    const body = await readFile(target);
    const type = MIME[extname(target).toLowerCase()] ?? "application/octet-stream";
    res.writeHead(200, { "content-type": type });
    res.end(body);
    return true;
  } catch {
    return false;
  }
}

function envelope<T>(data: T, quality: { state: string; observedAt: string | null; coverage: string }, errors: string[] = []): unknown {
  return {
    status: quality.state === "fresh" ? "ok" : "degraded",
    data,
    quality,
    provenance: [],
    errors,
  };
}

/** Create and start the application server (resolves once listening). */
export async function startServer(options: ServerOptions): Promise<ChokepointServer> {
  const metrics = options.metrics ?? new MetricsRegistry();
  const logger = options.logger ?? new StructuredLogger();
  const staticDir = resolve(options.staticDir ?? "dist");
  const startedAtMs = Date.now();
  // Fixture mode: the local-first no-credentials path (§16.1).
  const manager: DataManager = await createDataManager({ mode: "fixture" });

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void handle(req, res).catch((err) => {
      logger.error("request handler crashed", {
        errorClass: err instanceof Error ? err.name : "Unknown",
      });
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "error", data: null, quality: null, provenance: [], errors: ["internal error"] }));
      } else {
        res.end();
      }
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const started = Date.now();
    const correlationId = `req-${started}-${Math.floor(Math.random() * 1e6)}`;
    const url = new URL(req.url ?? "/", `http://localhost:${options.port}`);
    const pathname = url.pathname;
    res.setHeader("x-correlation-id", correlationId);

    const recordOutcome = (statusCode: number): void => {
      const route = routeLabel(pathname);
      const cls = statusClass(statusCode);
      metrics.inc("chokepoint_http_requests_total", { route, status: cls });
      if (cls === "5xx") metrics.inc("chokepoint_http_request_errors_total", { route });
      logger.info("request", {
        correlationId,
        requestId: correlationId,
        resultStatus: String(statusCode),
        durationMs: Date.now() - started,
        route,
      });
    };

    try {
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { "content-type": "application/json" });
        res.end(JSON.stringify(envelope(null, { state: "error", observedAt: null, coverage: "http" }, ["method not allowed"])));
        recordOutcome(405);
        return;
      }

      switch (pathname) {
        case "/api/health": {
          res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify(buildHealth("fixture", startedAtMs, Date.now()), null, 2));
          break;
        }
        case "/api/ready": {
          const payload = buildReadiness(manager);
          res.writeHead(payload.data.ready ? 200 : 503, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify(payload, null, 2));
          break;
        }
        case "/api/chokepoints": {
          const profiles = manager.listChokepoints().map((p) => ({
            id: p.id,
            name: p.name,
            region: p.region,
            mode: p.mode,
            configVersion: p.configVersion,
            geofenceCount: p.geofences.length,
            supportedMetrics: p.supportedMetrics,
            limitations: p.limitations,
          }));
          res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify(envelope(profiles, { state: "fresh", observedAt: null, coverage: "config registry" }), null, 2));
          break;
        }
        case "/api/attribution": {
          const snap = manager.getSnapshot(manager.listChokepoints()[0]!.id, manager.defaultWindow());
          res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify(envelope(snap.attribution, { state: "fresh", observedAt: null, coverage: "attribution registry" }), null, 2));
          break;
        }
        case "/metrics": {
          res.writeHead(200, { "content-type": "text/plain; version=0.0.4; charset=utf-8" });
          res.end(metrics.render());
          break;
        }
        default: {
          const served = await serveStatic(res, pathname, staticDir);
          if (!served) {
            res.writeHead(404, { "content-type": "application/json" });
            res.end(JSON.stringify(envelope(null, { state: "error", observedAt: null, coverage: "http" }, ["not found"])));
          }
        }
      }
      recordOutcome(res.statusCode);
    } catch (err) {
      logger.error("request failed", {
        correlationId,
        errorClass: err instanceof Error ? err.name : "Unknown",
      });
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify(envelope(null, { state: "error", observedAt: null, coverage: "http" }, ["internal error"])));
      } else {
        res.end();
      }
      recordOutcome(500);
    }
  }

  const boundPort = await new Promise<number>((resolveListen) => {
    server.listen(options.port, () => {
      const address = server.address();
      resolveListen(typeof address === "object" && address !== null ? address.port : options.port);
    });
  });
  logger.info("server listening", { resultStatus: "ok", version: SERVER_VERSION, port: boundPort });
  return {
    port: boundPort,
    close: () =>
      new Promise<void>((resolveClose) => {
        server.close(() => resolveClose());
      }),
  };
}
