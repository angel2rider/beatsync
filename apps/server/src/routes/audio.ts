import { errorResponse } from "@/utils/responses";
import { getAudioFilePath } from "@/lib/localStorage";
import { exists } from "node:fs/promises";

/**
 * Serve audio files from local filesystem.
 * Matches URL pattern: /audio-data/room-{roomId}/{fileName}
 */
export async function handleServeAudioData(pathname: string): Promise<Response> {
  try {
    // Parse the path: /audio-data/room-{roomId}/{fileName}
    const relativePath = pathname.replace(/^\/audio-data\//, "");
    const parts = relativePath.split("/");

    if (parts.length < 2 || !parts[0].startsWith("room-")) {
      return errorResponse("Invalid audio path", 400);
    }

    const roomId = parts[0].substring(5); // Remove "room-" prefix
    const fileName = decodeURIComponent(parts.slice(1).join("/"));

    const filePath = getAudioFilePath(roomId, fileName);

    if (!(await exists(filePath))) {
      return errorResponse("Audio file not found", 404);
    }

    // Use Bun.file for efficient file serving
    const file = Bun.file(filePath);
    const fileContentType = file.type || "audio/mpeg";

    return new Response(file, {
      headers: {
        "Content-Type": fileContentType,
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (error) {
    console.error("Error serving audio:", error);
    return errorResponse("Failed to serve audio", 500);
  }
}
