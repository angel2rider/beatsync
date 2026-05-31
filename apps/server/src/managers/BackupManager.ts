import { globalManager } from "@/managers/GlobalManager";
import { cleanupOldBackups, getLatestFile, readJSON, saveJSON } from "@/lib/localStorage";
import type { RoomBackupType, ServerBackupType } from "@/managers/RoomManager";
import { ServerBackupSchema } from "@/managers/RoomManager";

interface RoomRestoreResult {
  room: {
    id: string;
    numClients: number;
    numAudioSources: number;
    globalVolume: number;
  };
  success: boolean;
  error?: string;
}

export class BackupManager {
  private static readonly BACKUP_PREFIX = "state-backup/";

  /**
   * Generate a timestamped backup filename
   */
  private static generateBackupFilename(): string {
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, -5);
    return `${this.BACKUP_PREFIX}backup-${timestamp}.json`;
  }

  /**
   * Save the current server state to local filesystem
   */
  static async backupState(): Promise<void> {
    try {
      const rooms: ServerBackupType["data"]["rooms"] = {};

      globalManager.forEachRoom((room, roomId) => {
        rooms[roomId] = room.createBackup();
      });

      const backupData: ServerBackupType = {
        timestamp: Date.now(),
        data: { rooms },
      };

      const filename = this.generateBackupFilename();

      await saveJSON(filename, backupData);

      console.log(`✅ State backup completed: ${filename} (${Object.keys(rooms).length} rooms)`);

      await cleanupOldBackups(5);
    } catch (error) {
      console.error("❌ State backup failed:", error);
      throw error;
    }
  }

  /**
   * Restore server state from the latest backup on local filesystem
   */
  static async restoreState(): Promise<boolean> {
    try {
      console.log("🔍 Looking for state backups...");

      const latestBackupKey = await getLatestFile(this.BACKUP_PREFIX);

      if (!latestBackupKey) {
        console.log("📭 No backups found");
        return false;
      }

      console.log(`📥 Restoring from: ${latestBackupKey}`);

      const rawBackupData = await readJSON(latestBackupKey);

      if (!rawBackupData) {
        throw new Error("Failed to read backup data");
      }

      const parseResult = ServerBackupSchema.safeParse(rawBackupData);

      if (!parseResult.success) {
        throw new Error(`Invalid backup data format: ${parseResult.error.message}`);
      }

      const backupData = parseResult.data;
      const roomEntries = Object.entries(backupData.data.rooms);

      console.log(`🔄 Restoring ${roomEntries.length} rooms...`);

      const successful: RoomRestoreResult[] = [];
      const failed: RoomRestoreResult[] = [];

      for (const [roomId, roomData] of roomEntries) {
        const result = BackupManager.restoreRoom(roomId, roomData);
        if (result.success) {
          successful.push(result);
        } else {
          failed.push(result);
        }
      }

      const ageMinutes = Math.floor((Date.now() - backupData.timestamp) / 60000);

      console.log(`✅ State restoration completed from ${ageMinutes} minutes ago:`);
      console.log(`   - Successfully restored ${successful.length} rooms`);
      successful.forEach((result) => {
        console.log(
          `     Room ${result.room.id}: ${result.room.numClients} clients, ${result.room.numAudioSources} audio sources`
        );
      });

      if (failed.length > 0) {
        console.log(`   - Failed to restore: ${failed.length} rooms`);
        failed.forEach((failure) => {
          console.log(`     ❌ ${failure.room.id}: ${failure.error}`);
        });
      }

      return successful.length > 0;
    } catch (error) {
      console.error("❌ State restore failed:", error);
      return false;
    }
  }

  /**
   * Restore a single room from backup data
   */
  private static restoreRoom(roomId: string, roomData: RoomBackupType): RoomRestoreResult {
    try {
      const room = globalManager.getOrCreateRoom(roomId);

      // Restore audio sources (local files, no validation needed)
      room.setAudioSources(roomData.audioSources);

      // Restore client data
      room.restoreClientData(roomData.clientDatas);

      // Restore playback state
      const playbackStateIsValidTrack = roomData.audioSources.some(
        (source) => source.url === roomData.playbackState.audioSource
      );

      if (playbackStateIsValidTrack) {
        room.restorePlaybackState(roomData.playbackState);
      }

      // Restore chat history
      if (roomData.chat) {
        room.restoreChatHistory(roomData.chat);
        console.log(`Room ${roomId}: Restored ${roomData.chat.messages.length} chat messages`);
      }

      globalManager.scheduleRoomCleanup(roomId);

      return {
        room: {
          id: roomId,
          numClients: roomData.clientDatas.length,
          numAudioSources: roomData.audioSources.length,
          globalVolume: roomData.globalVolume,
        },
        success: true,
      };
    } catch (error) {
      console.error(`❌ Failed to restore room ${roomId}:`, error);
      return {
        room: {
          id: roomId,
          globalVolume: roomData.globalVolume,
          numClients: roomData.clientDatas.length,
          numAudioSources: roomData.audioSources.length,
        },
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
