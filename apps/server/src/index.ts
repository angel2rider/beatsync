import { ADMIN_SECRET, IS_DEMO_MODE } from "@/demo";
import { BackupManager } from "@/managers/BackupManager";
import { getActiveRooms } from "@/routes/active";
import { handleGetDefaultAudio } from "@/routes/default";
import { handleServeAudio } from "@/routes/demoAudio";
import { handleServeAudioData } from "@/routes/audio";
import { handleDiscover } from "@/routes/discover";
import { handleImageProxy } from "@/routes/imgProxy";
import { setImageProxyBase } from "@/managers/MusicProviderManager";
import { handleRoot } from "@/routes/root";
import { handleStats } from "@/routes/stats";
import { handleAudioUpload } from "@/routes/upload";
import { handleWebSocketUpgrade } from "@/routes/websocket";
import { handleClose, handleMessage, handleOpen } from "@/routes/websocketHandlers";
import { corsHeaders, errorResponse } from "@/utils/responses";
import type { WSData } from "@/utils/websocket";

// --- Server configuration from env vars ---
const PORT = parseInt(process.env.PORT ?? "8080", 10);
const HOST = process.env.HOST ?? "0.0.0.0";

/**
 * Detect public IP address on startup (best-effort, non-blocking).
 * Falls back to "<unknown>" if detection fails.
 */
let detectedPublicIp = "<unknown>";
function detectPublicIp(): void {
  const services = ["https://api.ipify.org?format=json", "https://ifconfig.me/ip", "https://api.ip.sb/ip"];

  const tryService = async (index: number) => {
    if (index >= services.length) {
      console.warn("⚠ Could not detect public IP (no services responded)");
      return;
    }
    try {
      const res = await fetch(services[index], { signal: AbortSignal.timeout(5_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      let ip: string;
      try {
        const parsed: Record<string, unknown> = JSON.parse(text) as Record<string, unknown>;
        ip = (typeof parsed.ip === "string" ? parsed.ip : null) ?? text.trim();
      } catch {
        ip = text.trim();
      }
      // Validate it looks like an IP
      if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) {
        detectedPublicIp = ip;
        console.log(`🌐 Detected public IP: ${ip}`);
        // Only override the image proxy base if SERVER_HOST is NOT explicitly set.
        // When using a custom domain (e.g. sync.elricc.site), the domain-based URL is preferred.
        if (!process.env.SERVER_HOST) {
          const scheme = process.env.SERVER_SECURE === "1" || process.env.SERVER_SECURE === "true" ? "https" : "http";
          const suffix = PORT === 80 || PORT === 443 ? "" : `:${PORT}`;
          setImageProxyBase(`${scheme}://${ip}${suffix}`);
          console.log(`   Image proxy updated: ${scheme}://${ip}${suffix}/api/img-proxy/...`);
        }
      } else {
        await tryService(index + 1);
      }
    } catch {
      await tryService(index + 1);
    }
  };

  // Fire and forget
  void tryService(0);
}

detectPublicIp();

// Configure image proxy base URL before the server starts (avoids timing race with async IP detection)
const isSecure = process.env.SERVER_SECURE === "1" || process.env.SERVER_SECURE === "true";
const proxyBaseHost = process.env.SERVER_HOST ?? "localhost";
// When SERVER_HOST is explicitly set (custom domain via reverse proxy), omit the port suffix
// since Nginx handles standard HTTPS (443) or HTTP (80) ports.
// Otherwise, append the server's listen port.
const proxyPortSuffix = process.env.SERVER_HOST ? "" : PORT === 80 || PORT === 443 ? "" : `:${PORT}`;
const initialProxyBase = `${isSecure ? "https" : "http"}://${proxyBaseHost}${proxyPortSuffix}`;
setImageProxyBase(initialProxyBase);
console.log(`   Image proxy: ${initialProxyBase}/api/img-proxy/...`);

// --- Server info endpoint ---
// Note: Not cached — detectedPublicIp may update asynchronously after startup
function getServerInfo(): { serverUrl: string; wsUrl: string } {
  const isSecure = process.env.SERVER_SECURE === "1" || process.env.SERVER_SECURE === "true";
  const hostDisplay = detectedPublicIp !== "<unknown>" ? detectedPublicIp : HOST;
  const proto = isSecure ? "https" : "http";
  const wsProto = isSecure ? "wss" : "ws";
  // When SERVER_HOST is explicitly set (custom domain via reverse proxy), omit the port suffix
  // since Nginx handles standard HTTPS (443) or HTTP (80) ports.
  const portSuffix = process.env.SERVER_HOST ? "" : PORT === 80 || PORT === 443 ? "" : `:${PORT}`;

  // If SERVER_HOST is explicitly set, use it (for custom domains)
  const effectiveHost = process.env.SERVER_HOST ?? hostDisplay;

  return {
    serverUrl: `${proto}://${effectiveHost}${portSuffix}`,
    wsUrl: `${wsProto}://${effectiveHost}${portSuffix}/ws`,
  };
}

// Bun.serve with WebSocket support
const server = Bun.serve<WSData>({
  hostname: HOST,
  port: PORT,
  async fetch(req, server) {
    const url = new URL(req.url);
    const pathname = url.pathname;

    // Handle CORS preflight requests
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Demo mode: serve bundled audio files
      if (IS_DEMO_MODE && pathname.startsWith("/audio/")) {
        return handleServeAudio(pathname);
      }

      // Serve audio files from local filesystem (all modes)
      if (pathname.startsWith("/audio-data/")) {
        return handleServeAudioData(pathname);
      }

      // Image proxy for album art (Tidal CDN is blocked, proxy via Deezer)
      if (pathname.startsWith("/api/img-proxy/")) {
        return handleImageProxy(req);
      }

      switch (pathname) {
        case "/api/server-info":
          return new Response(JSON.stringify(getServerInfo()), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });

        case "/":
          return handleRoot(req);

        case "/ws":
          return handleWebSocketUpgrade(req, server);

        case "/upload":
          if (IS_DEMO_MODE) return errorResponse("Uploads disabled in demo mode", 403);
          return handleAudioUpload(req, server);

        case "/stats":
          return handleStats();

        case "/default":
          return handleGetDefaultAudio(req);

        case "/active-rooms":
          return getActiveRooms(req);

        case "/discover":
          return handleDiscover(req);

        default:
          return errorResponse("Not found", 404);
      }
    } catch {
      return errorResponse("Internal server error", 500);
    }
  },

  websocket: {
    open(ws) {
      handleOpen(ws, server);
    },

    message(ws, message) {
      void handleMessage(ws, message, server);
    },

    close(ws) {
      handleClose(ws, server);
    },
  },
});

console.log(`🚀 Beatsync server listening on ${HOST}:${PORT}`);
console.log(`   Public URL:  ${getServerInfo().serverUrl}`);
console.log(`   WebSocket:   ${getServerInfo().wsUrl}`);

if (IS_DEMO_MODE) {
  console.log(`🔑 Admin secret: ${ADMIN_SECRET}`);
}

if (!IS_DEMO_MODE) {
  // Restore state from local backup on startup
  BackupManager.restoreState().catch((error) => {
    console.error("Failed to restore state on startup:", error);
  });

  // Set up periodic backups every minute
  const BACKUP_INTERVAL_MS = 60 * 1000; // 1 minute
  setInterval(() => {
    console.log("🔄 Performing periodic backup at", new Date().toISOString());
    BackupManager.backupState().catch((error) => {
      console.error("Failed to perform periodic backup:", error);
    });
  }, BACKUP_INTERVAL_MS);
}

// Simple graceful shutdown
const shutdown = async () => {
  console.log("\n⚠️ Shutting down...");

  void server.stop(); // Stop accepting new connections
  if (!IS_DEMO_MODE) {
    await BackupManager.backupState(); // Save state
  }

  process.exit(0);
};

// Handle shutdown signals
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
