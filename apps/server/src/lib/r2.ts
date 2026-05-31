/**
 * @deprecated This module has been replaced by @/lib/localStorage.
 * All R2/S3 functionality has been migrated to local filesystem storage.
 * These re-exports are kept for backward compatibility during migration.
 */
export { generateAudioFileName, getAudioUrl as getPublicAudioUrl } from "./localStorage";

/**
 * Create a key for local storage (kept for backward compatibility).
 */
export function createKey(roomId: string, fileName: string): string {
  return `room-${roomId}/${fileName}`;
}

/**
 * Extract a key from a local URL path.
 */
export function extractKeyFromUrl(url: string): string | null {
  const match = /^\/audio-data\/room-([^/]+)\/(.+)$/.exec(url);
  if (!match) {
    try {
      // Also try matching R2-style URLs (https://cdn.example.com/room-123/file.mp3)
      const urlObj = new URL(url);
      const pathWithoutLeadingSlash = urlObj.pathname.startsWith("/") ? urlObj.pathname.substring(1) : urlObj.pathname;
      const keyParts = pathWithoutLeadingSlash.split("/");
      const key = keyParts.join("/");
      return key;
    } catch {
      return null;
    }
  }
  return `room-${match[1]}/${decodeURIComponent(match[2])}`;
}

/**
 * @deprecated Not needed in single-server mode.
 */
export function validateAudioFileExists(_audioUrl: string): boolean {
  return true;
}

/**
 * @deprecated Not needed in single-server mode.
 */
export function validateR2Config(): { isValid: boolean; errors: string[] } {
  return { isValid: true, errors: [] };
}

/**
 * @deprecated Rooms are stored locally, use deleteRoomDirectory from localStorage.
 */
export function deleteObjectsWithPrefix(_prefix: string): { deletedCount: number } {
  return { deletedCount: 0 };
}

/**
 * @deprecated Rooms are stored locally.
 */
export function cleanupOrphanedRooms(
  _activeRoomIds: Set<string>,
  _performDeletion = false
): {
  orphanedRooms: { roomId: string; fileCount: number }[];
  totalRooms: number;
  totalFiles: number;
  deletedFiles?: number;
  errors?: string[];
} {
  return {
    orphanedRooms: [],
    totalRooms: 0,
    totalFiles: 0,
    deletedFiles: 0,
    errors: [],
  };
}

/**
 * @deprecated Use deleteAudioFileByUrl from localStorage.
 */
export async function deleteObject(_key: string): Promise<void> {
  // no-op in single-server mode
}

/**
 * @deprecated No longer needed in single-server mode.
 */
export async function uploadJSON(_key: string, _data: object): Promise<void> {
  // no-op
}

/**
 * @deprecated No longer needed in single-server mode.
 */
export function downloadJSON<T = unknown>(_key: string): T | null {
  return null;
}

/**
 * @deprecated No longer needed in single-server mode.
 */
export function getLatestFileWithPrefix(_prefix: string): string | null {
  return null;
}

/**
 * @deprecated No longer needed in single-server mode.
 */
export function getSortedFilesWithPrefix(_prefix: string, _extension?: string): string[] {
  return [];
}

export type OrphanCleanupResult = Awaited<ReturnType<typeof cleanupOrphanedRooms>>;
