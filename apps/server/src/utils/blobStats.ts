import { listFiles } from "@/lib/localStorage";
import { globalManager } from "@/managers";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";

const DATA_DIR = process.env.AUDIO_DATA_DIR ?? "./audio-data";

// Helper function to format bytes to human readable
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";

  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

interface RoomStorageInfo {
  fileCount: number;
  totalSize: string;
  totalSizeBytes: number;
  files: string[];
}

interface BlobStats {
  activeRooms: Record<string, RoomStorageInfo>;
  orphanedRooms: Record<string, { fileCount: number; totalSizeBytes: number; totalSize: string; files: string[] }>;
  orphanedCount: number;
  totalObjects: number;
  totalSize: string;
  totalSizeBytes: number;
}

export async function getBlobStats(): Promise<BlobStats> {
  // List all room files from local storage
  const allRoomFiles = await listFiles("room-");

  // Group files by room
  const roomFilesMap = new Map<string, string[]>();
  for (const filePath of allRoomFiles) {
    const match = /^room-([^/]+)\//.exec(filePath);
    if (match) {
      const roomId = match[1];
      if (!roomFilesMap.has(roomId)) {
        roomFilesMap.set(roomId, []);
      }
      roomFilesMap.get(roomId)!.push(filePath);
    }
  }

  // Get active room IDs
  const activeRoomIds = new Set<string>();
  globalManager.forEachRoom((_room, roomId) => {
    activeRoomIds.add(roomId);
  });

  const activeRooms: Record<string, RoomStorageInfo> = {};
  const orphanedRooms: Record<string, RoomStorageInfo> = {};

  let totalObjects = 0;
  let totalSizeBytes = 0;

  for (const [roomId, files] of roomFilesMap) {
    let roomSizeBytes = 0;
    for (const fileKey of files) {
      totalObjects++;
      // Try to get file size
      try {
        const filePath = resolve(DATA_DIR, fileKey);
        const fileStat = await stat(filePath);
        roomSizeBytes += fileStat.size;
        totalSizeBytes += fileStat.size;
      } catch {
        // File might have been deleted between listing and stat
      }
    }

    const info: RoomStorageInfo = {
      fileCount: files.length,
      totalSize: formatBytes(roomSizeBytes),
      totalSizeBytes: roomSizeBytes,
      files,
    };

    if (activeRoomIds.has(roomId)) {
      activeRooms[roomId] = info;
    } else {
      orphanedRooms[roomId] = info;
    }
  }

  return {
    activeRooms,
    orphanedRooms,
    orphanedCount: Object.keys(orphanedRooms).length,
    totalObjects,
    totalSize: formatBytes(totalSizeBytes),
    totalSizeBytes,
  };
}
