import { corsHeaders } from "@/utils/responses";

// In-memory cache: ISRC -> Deezer cover URL
const coverCache = new Map<string, string>();

const DEEZER_API = "https://api.deezer.com";

// Map our requested sizes to Deezer cover size fields
const sizeToDeezerField: Record<string, string> = {
  "80x80": "cover_small",
  "160x160": "cover_medium",
  "320x320": "cover_big",
  "640x640": "cover_xl",
};

/**
 * Image proxy that resolves Tidal cover UUIDs to Deezer CDN URLs via ISRC lookup.
 *
 * GET /api/img-proxy/:uuid/:size?isrc=...
 *
 * Flow:
 * 1. Check in-memory cache for ISRC -> Deezer URL mapping
 * 2. If cache miss and ISRC provided, look up Deezer API
 * 3. Redirect (302) to the Deezer CDN URL (zero server bandwidth)
 * 4. If all fails, return an SVG placeholder
 */
export async function handleImageProxy(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);

  // /api/img-proxy/{uuid}/{size}
  // pathParts = ['api', 'img-proxy', '<uuid>', '<size>']
  const uuid = pathParts[2];
  const size = pathParts[3] || "160x160";
  const isrc = url.searchParams.get("isrc");

  if (!uuid || !/^[a-f0-9-]+$/i.test(uuid)) {
    return new Response("Invalid cover UUID", {
      status: 400,
      headers: corsHeaders,
    });
  } // If we have an ISRC, check cache or look up Deezer
  if (isrc) {
    const cachedUrl = coverCache.get(isrc);
    if (cachedUrl) {
      return new Response(null, {
        status: 302,
        headers: {
          Location: cachedUrl,
          "Cache-Control": "public, max-age=86400",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    // Cache miss — look up Deezer API
    try {
      const deezerRes = await fetch(`${DEEZER_API}/track/isrc:${encodeURIComponent(isrc)}`, {
        signal: AbortSignal.timeout(5_000),
      });

      if (deezerRes.ok) {
        const data = (await deezerRes.json()) as Record<string, unknown>;
        const album = data.album as Record<string, unknown> | undefined;
        if (album) {
          const deezerField = sizeToDeezerField[size] || "cover_medium";
          const coverUrl = album[deezerField] as string | undefined;
          if (coverUrl) {
            // Strip size suffix to get a raw cover UUID URL, then re-apply our size
            const deezerImageId = coverUrl.replace(/^.*\/images\/cover\//, "").replace(/\/.*$/, "");
            // Deezer supports any size: https://e-cdns-images.dzcdn.net/images/cover/{hash}/{width}x{height}.jpg
            const [width, height] = size.split("x");
            const resolvedUrl = `https://e-cdns-images.dzcdn.net/images/cover/${deezerImageId}/${width}x${height}.jpg`;
            // Cache for future requests
            coverCache.set(isrc, resolvedUrl);
            return new Response(null, {
              status: 302,
              headers: {
                Location: resolvedUrl,
                "Cache-Control": "public, max-age=86400",
                "Access-Control-Allow-Origin": "*",
              },
            });
          }
        }
      }
    } catch {
      // Deezer lookup failed — will fall through to placeholder
    }
  }

  // No Deezer fallback available — return a stylish SVG placeholder
  const placeholderSize = parseInt(size.split("x")[0], 10) || 160;
  const fontSize = Math.round(placeholderSize * 0.3);

  return new Response(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${placeholderSize}" height="${placeholderSize}" viewBox="0 0 ${placeholderSize} ${placeholderSize}">
      <rect width="${placeholderSize}" height="${placeholderSize}" fill="#2a2a2a"/>
      <text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" fill="#555" font-size="${fontSize}" font-family="sans-serif">♪</text>
    </svg>`,
    {
      status: 200,
      headers: {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "public, max-age=3600",
        "Access-Control-Allow-Origin": "*",
      },
    }
  );
}
