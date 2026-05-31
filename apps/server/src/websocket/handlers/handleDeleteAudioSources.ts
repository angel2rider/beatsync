import { IS_DEMO_MODE } from "@/demo";
import { deleteAudioFileByUrl } from "@/lib/localStorage";
import { sendBroadcast } from "@/utils/responses";
import { requireCanMutate } from "@/websocket/middlewares";
import type { HandlerFunction } from "@/websocket/types";
import type { ExtractWSRequestFrom } from "@beatsync/shared";

export const handleDeleteAudioSources: HandlerFunction<ExtractWSRequestFrom["DELETE_AUDIO_SOURCES"]> = async ({
  ws,
  message,
  server,
}) => {
  const { room } = requireCanMutate(ws);

  // Get current URLs to validate the request
  const currentUrls = new Set(room.getAudioSources().map((s) => s.url));

  // Only process URLs that actually exist in the room
  const urlsToDelete = message.urls.filter((url) => currentUrls.has(url));

  if (urlsToDelete.length === 0) {
    return; // nothing to do, silent idempotency
  }

  // In demo mode, skip file deletion — just remove from room state
  if (IS_DEMO_MODE) {
    const { updated } = room.removeAudioSources(urlsToDelete);
    sendBroadcast({
      server,
      roomId: ws.data.roomId,
      message: {
        type: "ROOM_EVENT",
        event: { type: "SET_AUDIO_SOURCES", sources: updated },
      },
    });
    return;
  }

  // Delete files from local filesystem and track successes
  const deletionResults = await Promise.allSettled(
    urlsToDelete.map(async (url) => {
      try {
        await deleteAudioFileByUrl(url);
        return url;
      } catch (error) {
        console.error(`Failed to delete local file for URL ${url}:`, error);
        return null;
      }
    })
  );

  const successfullyDeletedUrls = deletionResults
    .filter((r) => r.status === "fulfilled" && r.value !== null)
    .map((r) => (r as PromiseFulfilledResult<string>).value);

  if (successfullyDeletedUrls.length === 0) {
    console.log("No local files were successfully deleted, keeping all in queue");
    return;
  }

  // Remove only the successfully deleted sources from room state
  const { updated } = room.removeAudioSources(successfullyDeletedUrls);

  // Broadcast updated queue to all clients
  sendBroadcast({
    server,
    roomId: ws.data.roomId,
    message: {
      type: "ROOM_EVENT",
      event: { type: "SET_AUDIO_SOURCES", sources: updated },
    },
  });
};
