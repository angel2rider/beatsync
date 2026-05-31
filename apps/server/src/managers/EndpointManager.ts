/**
 * EndpointManager — manages multiple hifi-api provider endpoints with
 * automatic failover and cooldown-based rate-limit recovery.
 *
 * When an endpoint returns an error (e.g. rate-limit 429, upstream error),
 * it's put into cooldown for a configurable period. Subsequent requests
 * skip endpoints in cooldown and try the next healthy one.
 *
 * Configuration order (highest priority first):
 *   1. PROVIDER_URLS env var (comma-separated list)
 *   2. PROVIDER_URL env var (single URL, backward-compat)
 *   3. Built-in default list
 */

const DEFAULT_ENDPOINTS = [
  "https://ohio-1.monochrome.tf",
  "https://frankfurt-1.monochrome.tf",
  "https://hifi-api-bffw.onrender.com",
  "https://monochrome-api.samidy.com",
] as const;

/** Default cooldown for a failed endpoint (milliseconds). */
const DEFAULT_COOLDOWN_MS = 30_000;

interface EndpointState {
  url: string;
  /** Timestamp (Date.now()) when the cooldown expires. 0 = healthy. */
  cooldownUntil: number;
  /** Consecutive failure count (reset on success). */
  failures: number;
}

export class EndpointManager {
  private endpoints: EndpointState[];
  private cooldownMs: number;
  /** Index of the last used endpoint (round-robin within healthy set). */
  private lastIndex = -1;

  constructor(cooldownMs = DEFAULT_COOLDOWN_MS) {
    this.cooldownMs = cooldownMs;
    this.endpoints = this.resolveEndpoints().map((url) => ({
      url,
      cooldownUntil: 0,
      failures: 0,
    }));
  }

  /**
   * Resolve the endpoint list from environment config.
   */
  private resolveEndpoints(): string[] {
    // 1. PROVIDER_URLS — comma-separated list
    const urlsEnv = process.env.PROVIDER_URLS;
    if (urlsEnv) {
      const urls = urlsEnv
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => s.replace(/\/+$/, ""));
      if (urls.length > 0) return urls;
    }

    // 2. PROVIDER_URL — single URL (backward-compat)
    const singleUrl = process.env.PROVIDER_URL;
    if (singleUrl) {
      return [singleUrl.replace(/\/+$/, "")];
    }

    // 3. Built-in defaults
    return [...DEFAULT_ENDPOINTS];
  }

  /**
   * Find the best healthy endpoint (round-robin, skipping cooldown).
   * Returns null if all endpoints are in cooldown.
   */
  private pickHealthyEndpoint(): EndpointState | null {
    const now = Date.now();

    // Gather healthy endpoints
    const healthy = this.endpoints.filter((ep) => now >= ep.cooldownUntil);

    if (healthy.length === 0) {
      // All in cooldown — use the one that recovers soonest
      const sorted = [...this.endpoints].sort((a, b) => a.cooldownUntil - b.cooldownUntil);
      const next = sorted[0];
      console.warn(
        `[EndpointManager] All endpoints in cooldown. Using ${next.url} (cooldown expires in ${Math.round((next.cooldownUntil - now) / 1000)}s)`
      );
      return next;
    }

    // Round-robin within healthy set
    const previousIndex = healthy.findIndex((ep) => this.endpoints.indexOf(ep) === this.lastIndex);
    const nextIndex = (previousIndex + 1) % healthy.length;
    const picked = healthy[nextIndex];
    this.lastIndex = this.endpoints.indexOf(picked);
    return picked;
  }

  /**
   * Mark an endpoint as failed, putting it into cooldown.
   * Cooldown duration escalates with consecutive failures (linear backoff).
   */
  markFailed(url: string): void {
    const ep = this.endpoints.find((e) => e.url === url);
    if (!ep) return;

    ep.failures += 1;

    // Escalate cooldown: each consecutive failure adds cooldownMs
    const cooldownDuration = this.cooldownMs * Math.min(ep.failures, 5);
    ep.cooldownUntil = Date.now() + cooldownDuration;

    console.warn(
      `[EndpointManager] ${url} marked failed (${ep.failures}x). Cooldown: ${Math.round(cooldownDuration / 1000)}s`
    );
  }

  /**
   * Mark an endpoint as healthy (reset cooldown and failures).
   */
  markHealthy(url: string): void {
    const ep = this.endpoints.find((e) => e.url === url);
    if (!ep) return;

    if (ep.failures > 0) {
      console.log(`[EndpointManager] ${url} recovered after ${ep.failures} failure(s)`);
    }

    ep.cooldownUntil = 0;
    ep.failures = 0;
  }

  /**
   * Perform a fetch to a healthy endpoint with automatic failover.
   * If the request fails, the endpoint is marked as failed and the next
   * healthy endpoint is tried. Retries up to `maxAttempts` times across
   * all endpoints.
   */
  async fetchWithFailover(
    pathname: string,
    searchParams?: Record<string, string>,
    maxAttempts = this.endpoints.length * 2 // enough to try each endpoint twice
  ): Promise<{ response: Response; endpointUrl: string }> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const endpoint = this.pickHealthyEndpoint();
      if (!endpoint) {
        throw new Error(`[EndpointManager] All endpoints are in cooldown. Last error: ${lastError?.message ?? "none"}`);
      }

      const url = new URL(pathname, endpoint.url);
      if (searchParams) {
        for (const [key, value] of Object.entries(searchParams)) {
          url.searchParams.set(key, value);
        }
      }

      try {
        const response = await fetch(url.toString());

        if (response.ok) {
          // Success — mark endpoint healthy
          this.markHealthy(endpoint.url);
          return { response, endpointUrl: endpoint.url };
        }

        // Non-OK status — treat as failure
        const bodyPreview = await response
          .text()
          .then((t) => t.slice(0, 200))
          .catch(() => "(no body)");
        lastError = new Error(`HTTP ${response.status} from ${endpoint.url}: ${bodyPreview}`);

        // Mark endpoint as failed for any non-OK response
        this.markFailed(endpoint.url);

        // Don't retry 4xx client errors (except 429 which is rate-limit)
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          throw new Object(
            `__CLIENT_ERR__${response.status} from ${endpoint.url}: ${bodyPreview}. Not retrying.`
          ) as unknown as Error;
        }

        // Continue to next endpoint (retry 429, 5xx, or other transient failures)
        continue;
      } catch (error) {
        if (error instanceof Error) {
          lastError = error;
          // Re-throw client errors (non-429 4xx) — they won't succeed on another endpoint
          if (error.message.startsWith("__CLIENT_ERR__")) {
            throw new Error(error.message.replace("__CLIENT_ERR__", "[EndpointManager] Client error "));
          }
          this.markFailed(endpoint.url);
        } else {
          lastError = new Error(String(error));
          this.markFailed(endpoint.url);
        }
        // Continue to next endpoint
      }
    }

    throw new Error(
      `[EndpointManager] All attempts exhausted (${maxAttempts}). Last error: ${lastError?.message ?? "Unknown"}`
    );
  }

  /**
   * Get diagnostics about all endpoints (for logging / admin endpoint).
   */
  getDiagnostics(): { url: string; cooldownRemainingMs: number; failures: number }[] {
    const now = Date.now();
    return this.endpoints.map((ep) => ({
      url: ep.url,
      cooldownRemainingMs: Math.max(0, ep.cooldownUntil - now),
      failures: ep.failures,
    }));
  }
}

/** Singleton instance — single source of truth across all providers. */
export const ENDPOINT_MANAGER = new EndpointManager();
