import { mock } from "bun:test";

/**
 * Default localStorage mock that stubs all filesystem operations as no-ops.
 * Call `mockR2()` at the top of your test file (before any imports that use localStorage).
 */
export function mockR2(overrides: Record<string, ReturnType<typeof mock>> = {}): void {
  const defaults: Record<string, ReturnType<typeof mock>> = {
    deleteRoomDirectory: mock(() => ({ deletedCount: 0 })),
    saveJSON: mock(() => {
      /* noop */
    }),
    readJSON: mock(() => null),
    getLatestFile: mock(() => null),
    getSortedFiles: mock(() => []),
    deleteFile: mock(() => {
      /* noop */
    }),
    deleteAudioFileByUrl: mock(() => {
      /* noop */
    }),
    listFiles: mock(() => []),
  };

  void mock.module("@/lib/localStorage", () => ({ ...defaults, ...overrides }));
}
