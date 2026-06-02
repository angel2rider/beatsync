import type { RawSearchResponseSchema, TrackSchema } from "@beatsync/shared";
import type { z } from "zod";
import { ENDPOINT_MANAGER } from "@/managers/EndpointManager";

// Image proxy base URL (set from server startup)
let imageProxyBase = "";

/**
 * Simple in-memory search cache with TTL and LRU eviction.
 * Stores raw search responses keyed by normalized query+offset.
 */
class SearchCache {
  private cache = new Map<string, { data: unknown; expiresAt: number }>();
  private maxEntries: number;
  private ttlMs: number;

  constructor(maxEntries = 50, ttlMs = 30_000) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
  }

  private makeKey(query: string, offset: number): string {
    return `${query.toLowerCase().trim()}|${offset}`;
  }

  get(query: string, offset: number): unknown {
    const key = this.makeKey(query, offset);
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.data;
  }

  set(query: string, offset: number, data: unknown): void {
    const key = this.makeKey(query, offset);
    this.cache.delete(key);
    this.cache.set(key, { data, expiresAt: Date.now() + this.ttlMs });
    // Evict oldest if over limit
    if (this.cache.size > this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }
  }

  invalidate(query: string): void {
    const prefix = query.toLowerCase().trim();
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix + "|")) this.cache.delete(key);
    }
  }

  clear(): void {
    this.cache.clear();
  }
}

const searchCache = new SearchCache();

/**
 * Safely convert a value to string when we expect it to be a string,
 * falling back to empty string if it's not a primitive string type.
 */
function safeString(val: unknown): string {
  return typeof val === "string" ? val : "";
}

/**
 * Set the base URL for the image proxy (called from server startup).
 * The URL should include the scheme and host, e.g. "http://152.70.71.168:8080".
 */
export function setImageProxyBase(baseUrl: string): void {
  imageProxyBase = baseUrl.replace(/\/+$/, "");
}

/**
 * Convert a Tidal cover UUID to proxy image URLs at various sizes.
 * The proxy resolves covers via Deezer CDN (Tidal CDN is blocked).
 */
function tidalCoverToImages(
  cover: string | null | undefined,
  isrc?: string | null
): {
  small: string;
  thumbnail: string;
  large: string;
  back: string | null;
} {
  if (!cover) {
    return {
      small: "",
      thumbnail: "",
      large: "",
      back: null,
    };
  }

  const isrcParam = isrc ? `?isrc=${encodeURIComponent(isrc)}` : "";
  const base = imageProxyBase || "http://localhost:8080";

  return {
    small: `${base}/api/img-proxy/${cover}/80x80${isrcParam}`,
    thumbnail: `${base}/api/img-proxy/${cover}/160x160${isrcParam}`,
    large: `${base}/api/img-proxy/${cover}/320x320${isrcParam}`,
    back: `${base}/api/img-proxy/${cover}/640x640${isrcParam}`,
  };
}

/**
 * Decode a base64-encoded Tidal manifest to extract audio URLs.
 * Supports both BTS (application/vnd.tidal.bts) and DASH (application/dash+xml) formats.
 */
function decodeManifest(manifest: string, manifestMimeType: string): { url: string } {
  try {
    const decoded = Buffer.from(manifest, "base64").toString("utf-8");

    if (manifestMimeType === "application/vnd.tidal.bts") {
      const parsed = JSON.parse(decoded) as { urls?: string[] };
      if (parsed.urls && Array.isArray(parsed.urls) && parsed.urls.length > 0) {
        return { url: parsed.urls[0] };
      }
    }

    // For DASH/MPD manifests, look for BaseURL elements or fall back to reporting the manifest itself
    if (manifestMimeType === "application/dash+xml") {
      // Try to extract the first audio URL from the MPD XML
      const baseUrlMatch = /<BaseURL>([^<]+)<\/BaseURL>/.exec(decoded);
      if (baseUrlMatch?.[1]) {
        return { url: baseUrlMatch[1] };
      }
    }

    // Fallback: try to find any URL in the decoded JSON
    try {
      const parsed = JSON.parse(decoded) as Record<string, unknown>;
      if (typeof parsed === "object" && parsed !== null) {
        // Check for nested url/urls
        for (const key of ["url", "urls", "Url", "Urls"]) {
          const val = parsed[key];
          if (typeof val === "string") return { url: val };
          if (Array.isArray(val) && val.length > 0 && typeof val[0] === "string") return { url: val[0] };
        }
      }
    } catch {
      // Ignore JSON parse errors in fallback
    }

    throw new Error(`Unsupported manifest format: ${manifestMimeType}`);
  } catch (error) {
    throw new Error(`Failed to decode manifest: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}

/**
 * Response structure expected from the hifi-api manifest endpoint.
 */
interface StreamManifestResponse {
  manifest?: string;
  manifestMimeType?: string;
}

export class MusicProviderManager {
  constructor() {
    // EndpointManager is self-initializing; nothing else needed in constructor.
    // Log initial diagnostics to show which endpoints are configured.
    const diagnostics = ENDPOINT_MANAGER.getDiagnostics();
    console.log(`[MusicProvider] Configured ${diagnostics.length} provider endpoint(s):`);
    diagnostics.forEach((d) => console.log(`  ${d.url}`));
  }

  /**
   * Search for tracks using the hifi-api (Tidal proxy).
   * The hifi-api wraps responses with { version, data }, with data containing
   * items from Tidal's /v1/search/tracks endpoint.
   */
  async search(query: string, offset = 0): Promise<z.infer<typeof RawSearchResponseSchema>> {
    // Check cache first
    const cached = searchCache.get(query, offset);
    if (cached) {
      return cached as z.infer<typeof RawSearchResponseSchema>;
    }

    try {
      // Reduced maxAttempts for search: try at most 2 endpoints (no point retrying 8x for a user-facing search)
      const { response } = await ENDPOINT_MANAGER.fetchWithFailover(
        "/search/",
        {
          s: query,
          offset: String(offset),
          limit: "50",
        },
        2
      );

      const raw: unknown = await response.json();

      // hifi-api wraps responses as { version: "2.10", data: <TidalResponse> }
      // Items are directly in the items array (not wrapped in { item: ... })
      const wrapper = raw as {
        version?: string;
        data?: {
          items?: Record<string, unknown>[];
          limit?: number;
          offset?: number;
          totalNumberOfResults?: number;
        };
      };
      const tidalData = wrapper?.data;

      if (!tidalData || !Array.isArray(tidalData.items)) {
        // Return empty results if no items
        return {
          data: {
            tracks: {
              limit: 50,
              offset,
              total: 0,
              items: [],
            },
          },
        } as z.infer<typeof RawSearchResponseSchema>;
      }

      // Transform Tidal items to Beatsync's expected TrackSchema
      const items: z.infer<typeof TrackSchema>[] = tidalData.items
        .filter((tidal): tidal is Record<string, unknown> => tidal != null && typeof tidal === "object")
        .map((tidal) => {
          const album = (tidal.album ?? {}) as Record<string, unknown>;
          const artist = (tidal.artist ?? {}) as Record<string, unknown>;
          const artists = (tidal.artists ?? []) as Record<string, unknown>[];

          // Extract cover UUID from album.cover
          const cover = typeof album.cover === "string" ? album.cover : undefined;
          const trackIsrc = typeof tidal.isrc === "string" ? tidal.isrc : null;
          const images = tidalCoverToImages(cover, trackIsrc);

          // Determine performer (use first artist if available, fallback to artist object)
          const mainArtist = artists.find((a: Record<string, unknown>) => a.type === "MAIN");
          const performer = mainArtist ?? artist;

          // Check for explicit/parental content
          const isExplicit = tidal.explicit === true || tidal.explicit === "true";

          // Parse release date
          const releaseDate =
            typeof album.releaseDate === "string"
              ? album.releaseDate
              : typeof album.release_date_original === "string"
                ? album.release_date_original
                : "";

          return {
            id: typeof tidal.id === "number" ? tidal.id : Number(tidal.id) || 0,
            title: safeString(tidal.title),
            duration: typeof tidal.duration === "number" ? tidal.duration : Number(tidal.duration) || 0,
            performer: {
              name: safeString(performer?.name) || safeString(performer?.Name) || "Unknown",
              id: typeof performer?.id === "number" ? performer.id : Number(performer?.id) || 0,
            },
            album: {
              image: images,
              artists: Array.isArray(album.artists)
                ? (album.artists as Record<string, unknown>[]).map((a: Record<string, unknown>) => ({
                    id: typeof a.id === "number" ? a.id : Number(a.id) || 0,
                    name: safeString(a.name),
                    roles: Array.isArray(a.roles) ? (a.roles as string[]) : [],
                  }))
                : undefined,
              title: safeString(album.title),
              duration: typeof album.duration === "number" ? album.duration : Number(album.duration) || 0,
              parental_warning: isExplicit,
              genre: undefined,
              id: safeString(album.id),
              release_date_original: releaseDate,
            },
            track_number: typeof tidal.trackNumber === "number" ? tidal.trackNumber : Number(tidal.trackNumber) || 0,
            isrc: typeof tidal.isrc === "string" ? tidal.isrc : null,
            version: typeof tidal.version === "string" ? tidal.version : null,
            parental_warning: isExplicit,
            composer: undefined,
            released_at: undefined,
          };
        });

      const result: z.infer<typeof RawSearchResponseSchema> = {
        data: {
          tracks: {
            limit: tidalData.limit ?? 50,
            offset: tidalData.offset ?? offset,
            total: tidalData.totalNumberOfResults ?? items.length,
            items,
          },
        },
      };

      // Cache the result
      searchCache.set(query, offset, result);

      return result;
    } catch (error) {
      throw new Error(`Search failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  /**
   * Get a streamable audio URL for a track.
   * Calls hifi-api's /track/ endpoint and decodes the base64 manifest.
   */
  async stream(trackId: number): Promise<{ url: string }> {
    try {
      const { response } = await ENDPOINT_MANAGER.fetchWithFailover("/track/", {
        id: String(trackId),
        quality: "LOSSLESS",
      });

      const raw: unknown = await response.json();

      // hifi-api wraps as { version: "2.10", data: <PlaybackInfo> }
      const wrapper = raw as { version?: string; data?: StreamManifestResponse };
      const playbackInfo = wrapper?.data;

      if (!playbackInfo?.manifest) {
        throw new Error("No manifest in stream response");
      }

      const manifestMimeType = playbackInfo.manifestMimeType ?? "application/vnd.tidal.bts";

      // Decode the base64 manifest to extract the audio URL
      const result = decodeManifest(playbackInfo.manifest, manifestMimeType);

      return result;
    } catch (error) {
      throw new Error(`Stream failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }
}

// Export singleton instance
export const MUSIC_PROVIDER_MANAGER = new MusicProviderManager();
