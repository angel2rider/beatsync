import { R2_AUDIO_FILE_NAME_DELIMITER } from "@beatsync/shared";
import { exists, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sanitize from "sanitize-filename";

const DATA_DIR = process.env.AUDIO_DATA_DIR ?? "./audio-data";
const BACKUPS_DIR = resolve(DATA_DIR, "../backups");

export interface AudioFileMetadata {
  roomId: string;
  fileName: string;
  contentType: string;
  fileSize: number;
  uploadedAt: string;
}

/**
 * Ensure a directory exists, creating it recursively if needed.
 */
async function ensureDir(dir: string): Promise<void> {
  if (!(await exists(dir))) {
    await mkdir(dir, { recursive: true });
  }
}

/**
 * Get the local path for a room's audio files.
 */
function getRoomDir(roomId: string): string {
  return resolve(DATA_DIR, `room-${roomId}`);
}

/**
 * Get the absolute path to an audio file.
 */
export function getAudioFilePath(roomId: string, fileName: string): string {
  return resolve(getRoomDir(roomId), fileName);
}

/**
 * Get the URL path for an audio file (served by the local server).
 */
export function getAudioUrl(roomId: string, fileName: string): string {
  // URL-encode the filename to handle special characters
  const encodedFileName = encodeURIComponent(fileName);
  return `/audio-data/room-${roomId}/${encodedFileName}`;
}

/**
 * Generate a unique file name for audio uploads.
 */
export function generateAudioFileName(originalName: string): string {
  const extensionRaw = originalName.split(".").pop();
  const extension = extensionRaw && extensionRaw.length > 0 ? extensionRaw : "mp3";

  const nameWithoutExt = originalName.replace(/\.[^/.]+$/, "");

  const nameWithoutSlashes = nameWithoutExt.replace(/[/\\]/g, "-");

  let safeName = sanitize(nameWithoutSlashes, { replacement: "*" });

  const maxNameLength = 400;
  if (safeName.length > maxNameLength) {
    safeName = safeName.substring(0, maxNameLength);
  }

  if (!safeName) {
    safeName = "audio";
  }

  const now = new Date();
  const dateStr = now.toISOString().replace(":", "-");

  return `${safeName}${R2_AUDIO_FILE_NAME_DELIMITER}${dateStr}.${extension}`;
}

/**
 * Save audio bytes to local storage.
 * Returns the local URL path for the file.
 */
export async function saveAudioFile(
  bytes: Uint8Array | ArrayBuffer,
  roomId: string,
  fileName: string,
  _contentType = "audio/mpeg"
): Promise<string> {
  const roomDir = getRoomDir(roomId);
  await ensureDir(roomDir);

  const body = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  const filePath = resolve(roomDir, fileName);

  await writeFile(filePath, body);

  console.log(`Saved audio file: ${filePath} (${body.byteLength} bytes)`);

  return getAudioUrl(roomId, fileName);
}

/**
 * Save JSON data to local storage (for backups).
 */
export async function saveJSON(key: string, data: object): Promise<void> {
  await ensureDir(BACKUPS_DIR);

  const filePath = resolve(BACKUPS_DIR, key.replace(/^backups\//, ""));
  // Ensure the subdirectory exists
  const dir = resolve(filePath, "..");
  await ensureDir(dir);

  const jsonData = JSON.stringify(data, null, 2);
  await writeFile(filePath, jsonData);
  console.log(`Saved JSON backup: ${filePath}`);
}

/**
 * Read and parse JSON data from local storage.
 */
export async function readJSON<T = unknown>(key: string): Promise<T | null> {
  const filePath = resolve(BACKUPS_DIR, key.replace(/^backups\//, ""));
  try {
    const data = await readFile(filePath, "utf-8");
    return JSON.parse(data) as T;
  } catch (error) {
    console.error(`Failed to read JSON from ${filePath}:`, error);
    return null;
  }
}

/**
 * List all files with a given prefix in the audio data directory.
 */
export async function listFiles(prefix: string): Promise<string[]> {
  try {
    // Handle "room-" prefix for room audio files
    if (prefix.startsWith("room-")) {
      const roomDir = resolve(DATA_DIR, prefix);
      if (!(await exists(roomDir))) {
        return [];
      }

      const entries = await readdir(roomDir, { withFileTypes: true });
      return entries.filter((e) => e.isFile()).map((e) => `${prefix}/${e.name}`);
    }

    // Handle backup prefix
    if (prefix.startsWith("state-backup/")) {
      if (!(await exists(BACKUPS_DIR))) {
        return [];
      }
      const entries = await readdir(BACKUPS_DIR, { withFileTypes: true });
      return entries
        .filter((e) => e.isFile() && e.name.startsWith("backup-"))
        .map((e) => `${prefix.split("/")[0]}/${e.name}`);
    }

    return [];
  } catch (error) {
    console.error(`Failed to list files with prefix "${prefix}":`, error);
    return [];
  }
}

/**
 * Get the latest file from a sorted list (by name, descending).
 */
export async function getLatestFile(prefix: string): Promise<string | null> {
  const files = await listFiles(prefix);
  if (files.length === 0) return null;

  // Sort by name descending (ISO timestamps sort lexically)
  files.sort().reverse();
  return files[0];
}

/**
 * Get all files with a given prefix, sorted by name (newest first), optionally filtered by extension.
 */
export async function getSortedFiles(prefix: string, extension?: string): Promise<string[]> {
  const files = await listFiles(prefix);
  const filtered = extension ? files.filter((f) => f.endsWith(extension)) : files;
  filtered.sort().reverse();
  return filtered;
}

/**
 * Delete an audio file by its URL path.
 * URL format: "/audio-data/room-{roomId}/{fileName}"
 */
export async function deleteAudioFileByUrl(url: string): Promise<void> {
  const match = /^\/audio-data\/room-([^/]+)\/(.+)$/.exec(url);
  if (!match) {
    throw new Error(`Cannot extract room/file from URL: ${url}`);
  }
  const roomId = match[1];
  const fileName = decodeURIComponent(match[2]);
  const filePath = resolve(getRoomDir(roomId), fileName);
  if (await exists(filePath)) {
    await rm(filePath);
    console.log(`Deleted local audio file: ${filePath}`);
  }
}

/**
 * Delete a single file by its key.
 * Key format: "room-{roomId}/{fileName}" or "state-backup/{fileName}"
 */
export async function deleteFile(key: string): Promise<void> {
  try {
    if (key.startsWith("room-")) {
      const filePath = resolve(DATA_DIR, key);
      if (await exists(filePath)) {
        await rm(filePath);
        console.log(`Deleted file: ${filePath}`);
      }
    } else if (key.startsWith("state-backup/")) {
      const filePath = resolve(BACKUPS_DIR, key.replace(/^state-backup\//, ""));
      if (await exists(filePath)) {
        await rm(filePath);
        console.log(`Deleted backup: ${filePath}`);
      }
    }
  } catch (error) {
    console.error(`Failed to delete file ${key}:`, error);
    throw error;
  }
}

/**
 * Delete all files for a room.
 */
export async function deleteRoomDirectory(roomId: string): Promise<{ deletedCount: number }> {
  const roomDir = getRoomDir(roomId);
  try {
    if (!(await exists(roomDir))) {
      return { deletedCount: 0 };
    }

    const entries = await readdir(roomDir);
    let deletedCount = 0;
    for (const entry of entries) {
      const filePath = resolve(roomDir, entry);
      const fileStat = await stat(filePath);
      if (fileStat.isFile()) {
        await rm(filePath);
        deletedCount++;
      }
    }

    // Remove the empty directory
    await rm(roomDir, { recursive: true, force: true });
    console.log(`Deleted room directory: ${roomDir} (${deletedCount} files)`);

    return { deletedCount };
  } catch (error) {
    console.error(`Failed to delete room ${roomId}:`, error);
    throw error;
  }
}

/**
 * Clean up old backup files, keeping only the most recent N.
 */
export async function cleanupOldBackups(keepCount = 5): Promise<void> {
  try {
    const backups = await getSortedFiles("state-backup/", ".json");
    if (backups.length <= keepCount) return;

    const toDelete = backups.slice(keepCount);
    for (const key of toDelete) {
      await deleteFile(key);
    }

    console.log(`Cleaned up ${toDelete.length} old backups (keeping ${keepCount})`);
  } catch (error) {
    console.error("Backup cleanup failed (non-critical):", error);
  }
}
