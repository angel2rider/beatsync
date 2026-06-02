import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import sinon from "sinon";
import { mockR2 } from "@/__tests__/mocks/r2";
import { createMockWs } from "@/__tests__/mocks/websocket";
import { globalManager } from "@/managers/GlobalManager";

// ---------------------------------------------------------------------------
// Spy on deleteRoomDirectory using the existing mockR2 infrastructure.
// The explicit type parameters allow TypeScript to infer the call signature
// so that .mock.calls[n] has the correct tuple type.
// ---------------------------------------------------------------------------
const spyDeleteRoomDirectory = mock<(roomId: string, audioUrls: string[]) => Promise<{ deletedCount: number }>>(() =>
  Promise.resolve({ deletedCount: 0 })
);

mockR2({ deleteRoomDirectory: spyDeleteRoomDirectory });

describe("Oracle Object Cleanup", () => {
  let clock: sinon.SinonFakeTimers;

  beforeEach(() => {
    clock = sinon.useFakeTimers();

    // Tear down any rooms left over from previous tests
    for (const roomId of globalManager.getRoomIds()) {
      globalManager.deleteRoom(roomId);
    }

    spyDeleteRoomDirectory.mockClear();
  });

  afterEach(() => {
    clock.restore();
  });

  // -----------------------------------------------------------------------
  // Verifies that cleanup() feeds audio source URLs to deleteRoomDirectory
  // -----------------------------------------------------------------------
  it("should call deleteRoomDirectory with audio source URLs when room is cleaned up", async () => {
    const roomId = "oracle-cleanup-urls";
    const room = globalManager.getOrCreateRoom(roomId);

    room.addAudioSource({ url: "https://example.com/o/audio1.mp3", name: "A1" });
    room.addAudioSource({ url: "https://example.com/o/audio2.mp3", name: "A2" });

    await room.cleanup();

    expect(spyDeleteRoomDirectory).toHaveBeenCalledTimes(1);
    expect(spyDeleteRoomDirectory).toHaveBeenCalledWith(roomId, [
      "https://example.com/o/audio1.mp3",
      "https://example.com/o/audio2.mp3",
    ]);
  });

  // -----------------------------------------------------------------------
  // Verifies that scheduleRoomCleanup fires cleanup after the 120 s delay
  // -----------------------------------------------------------------------
  it("should fire deleteRoomDirectory via scheduleRoomCleanup after the 120 s delay", async () => {
    const roomId = "oracle-cleanup-timer";
    const room = globalManager.getOrCreateRoom(roomId);

    room.addAudioSource({ url: "https://example.com/o/track.mp3", name: "Track" });

    // Add a client then remove it so scheduleRoomCleanup will schedule cleanup
    const ws = createMockWs({ clientId: "client-1", roomId });
    room.addClient(ws);
    room.removeClient("client-1");

    globalManager.scheduleRoomCleanup(roomId);

    // Advance past the 120 s delay
    clock.tick(120_001);

    // The cleanup callback is async.  Each `await` in the chain queues a
    // separate microtask, so we flush the queue several times to let the
    // full chain (room.cleanup → deleteRoomDirectory → …) complete.
    for (let i = 0; i < 5; i++) {
      await Promise.resolve();
    }

    expect(spyDeleteRoomDirectory).toHaveBeenCalledTimes(1);
    expect(spyDeleteRoomDirectory).toHaveBeenCalledWith(roomId, ["https://example.com/o/track.mp3"]);
    expect(globalManager.hasRoom(roomId)).toBe(false);
  });

  // -----------------------------------------------------------------------
  // Verifies that cleanup does NOT fire if a client rejoins within the window
  // -----------------------------------------------------------------------
  it("should NOT fire cleanup when a client rejoins within the grace period", async () => {
    const roomId = "oracle-cleanup-rejoin";
    const room = globalManager.getOrCreateRoom(roomId);

    room.addAudioSource({ url: "https://example.com/o/song.mp3", name: "Song" });

    // Add a client then remove them so scheduleRoomCleanup will schedule
    const ws = createMockWs({ clientId: "client-rejoin", roomId });
    room.addClient(ws);
    room.removeClient("client-rejoin");

    globalManager.scheduleRoomCleanup(roomId);

    // ── client rejoins halfway through the delay ─────────────────────────
    clock.tick(60_000);
    room.addClient(createMockWs({ clientId: "client-rejoin-2", roomId }));

    // ── advance past the original deadline ───────────────────────────────
    clock.tick(60_001);
    for (let i = 0; i < 5; i++) {
      await Promise.resolve();
    }

    // Cleanup should NOT have fired
    expect(spyDeleteRoomDirectory).toHaveBeenCalledTimes(0);
    expect(globalManager.hasRoom(roomId)).toBe(true);
  });
});
