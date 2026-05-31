/**
 * Resolves API and WS base URLs.
 *
 * Resolution priority:
 *   1. NEXT_PUBLIC_API_URL / NEXT_PUBLIC_WS_URL (explicit build-time config)
 *   2. window.location (same-origin — works with Caddy/nginx reverse proxy)
 *   3. Runtime fetch of /api/server-info from the server (VPS without proxy)
 */

let cached: { apiUrl: string; wsUrl: string } | null = null;
let runtimeInitPromise: Promise<void> | null = null;

function resolve(): { apiUrl: string; wsUrl: string } {
  if (cached) return cached;

  const envApi = process.env.NEXT_PUBLIC_API_URL;
  const envWs = process.env.NEXT_PUBLIC_WS_URL;

  if (envApi && envWs) {
    cached = { apiUrl: envApi, wsUrl: envWs };
  } else if (typeof window !== "undefined") {
    const { protocol, host } = window.location;
    const isSecure = protocol === "https:";
    cached = {
      apiUrl: `${protocol}//${host}`,
      wsUrl: `${isSecure ? "wss" : "ws"}://${host}/ws`,
    };

    // Kick off a background fetch to try to discover the real server (e.g. on port 8080).
    // If it resolves, it overrides the cached value for subsequent calls.
    if (!runtimeInitPromise) {
      runtimeInitPromise = initRuntimeServerConfig();
    }
  } else {
    // SSR fallback — don't cache empty strings so client can resolve properly after hydration
    return { apiUrl: "", wsUrl: "" };
  }

  return cached;
}

export function getApiUrl(): string {
  return resolve().apiUrl;
}

export function getWsUrl(): string {
  return resolve().wsUrl;
}

/**
 * Attempt to resolve the real server URL at runtime by fetching /api/server-info
 * from candidate origins. Updates the module-level cache if successful so that
 * subsequent getApiUrl() / getWsUrl() calls return the correct addresses.
 */
async function initRuntimeServerConfig(): Promise<void> {
  if (typeof window === "undefined") return;

  const { protocol, hostname, port } = window.location;
  const baseOrigin = `${protocol}//${window.location.host}`;

  // Candidate origins to try, in order:
  const candidates = [baseOrigin];

  // If we're not already on the default server port, try it too
  if (port !== "8080") {
    candidates.push(`${protocol}//${hostname}:8080`);
  }

  for (const origin of candidates) {
    try {
      const res = await fetch(`${origin}/api/server-info`, {
        signal: AbortSignal.timeout(3_000),
      });
      if (res.ok) {
        const info: { serverUrl: string; wsUrl: string } = await res.json();
        cached = { apiUrl: info.serverUrl, wsUrl: info.wsUrl };
        console.log(`[RuntimeConfig] Resolved server from ${origin}:`, cached);
        return;
      }
    } catch {
      // Candidate didn't respond, try next
    }
  }
}
