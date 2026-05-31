import { jsonResponse } from "@/utils/responses";

export function handleGetDefaultAudio(_req: Request) {
  // Default tracks are not available in single-server mode
  // Users stream music through the hifi-api provider instead
  return jsonResponse([]);
}
