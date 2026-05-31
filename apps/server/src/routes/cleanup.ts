import { listFiles, deleteFile } from "@/lib/localStorage";
import { globalManager } from "@/managers";
import { errorResponse, jsonResponse } from "@/utils/responses";

interface CleanupResult {
  mode: "dry-run" | "live";
  orphanedRooms: { roomId: string; fileCount: number }[];
  totalRooms: number;
  totalFiles: number;
  deletedFiles?: number;
  errors?: string[];
}

export async function handleCleanup(req: Request) {
  try {
    // Parse query parameters
    const url = new URL(req.url);
    const mode = url.searchParams.get("mode");
    const isLive = mode === "live";

    console.log(`🧹 Starting Local Orphaned Room Cleanup via API`);
    console.log(`Mode: ${isLive ? "LIVE (will delete files)" : "DRY RUN (no deletions)"}\n`);

    // Get active rooms from server
    const activeRoomIds = new Set<string>();
    globalManager.forEachRoom((room, roomId) => {
      activeRoomIds.add(roomId);
    });

    // List all room directories in audio-data
    const roomFiles = await listFiles("room-");

    // Group files by room
    const roomFilesMap = new Map<string, string[]>();
    for (const filePath of roomFiles) {
      const match = /^room-([^/]+)\//.exec(filePath);
      if (match) {
        const roomId = match[1];
        if (!roomFilesMap.has(roomId)) {
          roomFilesMap.set(roomId, []);
        }
        roomFilesMap.get(roomId)!.push(filePath);
      }
    }

    // Identify orphaned rooms
    const orphanedRooms: { roomId: string; fileCount: number }[] = [];
    let totalFiles = 0;

    roomFilesMap.forEach((files, roomId) => {
      if (!activeRoomIds.has(roomId)) {
        orphanedRooms.push({ roomId, fileCount: files.length });
        totalFiles += files.length;
      }
    });

    console.log(`Found ${orphanedRooms.length} orphaned rooms (${totalFiles} files)`);

    const result: CleanupResult = {
      mode: isLive ? "live" : "dry-run",
      orphanedRooms,
      totalRooms: orphanedRooms.length,
      totalFiles,
      deletedFiles: 0,
      errors: [],
    };

    // Delete orphaned rooms if requested
    if (isLive) {
      let deletedCount = 0;
      for (const { roomId } of orphanedRooms) {
        const roomFiles = roomFilesMap.get(roomId) ?? [];
        for (const fileKey of roomFiles) {
          try {
            await deleteFile(fileKey);
            deletedCount++;
          } catch (error) {
            const msg = `Failed to delete ${fileKey}: ${error instanceof Error ? error.message : String(error)}`;
            console.error(msg);
            result.errors!.push(msg);
          }
        }
      }
      result.deletedFiles = deletedCount;
      console.log(`Cleanup complete! Deleted ${deletedCount} files`);
    } else {
      console.log("DRY RUN — no files deleted");
    }

    return jsonResponse(result);
  } catch (error) {
    console.error("Cleanup failed:", error);
    return errorResponse(`Cleanup failed: ${error instanceof Error ? error.message : String(error)}`, 500);
  }
}
