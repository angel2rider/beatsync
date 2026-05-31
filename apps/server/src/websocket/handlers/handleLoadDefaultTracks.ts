import { IS_DEMO_MODE } from "@/demo";
import { requireCanMutate } from "@/websocket/middlewares";
import type { HandlerFunction } from "@/websocket/types";
import type { ExtractWSRequestFrom } from "@beatsync/shared";

export const handleLoadDefaultTracks: HandlerFunction<ExtractWSRequestFrom["LOAD_DEFAULT_TRACKS"]> = ({ ws }) => {
  if (IS_DEMO_MODE) return;
  requireCanMutate(ws);

  // Default tracks are not available in single-server mode.
  // Users search and stream music through the hifi-api provider.
  console.log(`[${ws.data.roomId}] Load default tracks requested but no defaults available in single-server mode`);
};
