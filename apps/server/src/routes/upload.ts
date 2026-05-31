import type { BunServer } from "@/utils/websocket";
import { generateAudioFileName, saveAudioFile } from "@/lib/localStorage";
import { globalManager } from "@/managers";
import { errorResponse, jsonResponse, sendBroadcast } from "@/utils/responses";

// Single endpoint to handle direct audio file uploads
export const handleAudioUpload = async (req: Request, server: BunServer) => {
  try {
    if (req.method !== "POST") {
      return errorResponse("Method not allowed", 405);
    }

    const contentType = req.headers.get("content-type") ?? "";

    // Support both multipart/form-data and direct binary upload
    let roomId: string;
    let fileBuffer: ArrayBuffer;
    let originalFileName: string;
    let fileMimeType: string;

    if (contentType.includes("multipart/form-data")) {
      // Multipart upload
      const formData = await req.formData();
      const file = formData.get("file") as File | null;
      roomId = (formData.get("roomId") as string) ?? "";

      if (!file || !roomId) {
        return errorResponse("Missing file or roomId in form data", 400);
      }

      fileBuffer = await file.arrayBuffer();
      originalFileName = file.name;
      fileMimeType = file.type || "audio/mpeg";
    } else if (contentType.includes("application/json")) {
      // JSON with base64 audio data (legacy support)
      const body: unknown = await req.json();
      const data = body as { roomId?: string; fileData?: string; fileName?: string; mimeType?: string };
      roomId = data.roomId ?? "";

      if (!data.fileData || !roomId) {
        return errorResponse("Missing fileData or roomId", 400);
      }

      // Decode base64
      const binaryString = atob(data.fileData);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      fileBuffer = bytes.buffer;
      originalFileName = data.fileName ?? "audio.mp3";
      fileMimeType = data.mimeType ?? "audio/mpeg";
    } else {
      // Assume direct binary upload with roomId in query or header
      roomId = req.headers.get("X-Room-Id") ?? "";
      if (!roomId) {
        const url = new URL(req.url);
        roomId = url.searchParams.get("roomId") ?? "";
      }

      if (!roomId) {
        return errorResponse("Missing roomId. Provide via X-Room-Id header or ?roomId= query param.", 400);
      }

      fileBuffer = await req.arrayBuffer();
      originalFileName = req.headers.get("X-File-Name") ?? `upload-${Date.now()}.mp3`;
      fileMimeType = contentType || "audio/mpeg";
    }

    // Check if room exists
    const room = globalManager.getRoom(roomId);
    if (!room) {
      return errorResponse("Room not found. Please join the room before uploading files.", 404);
    }

    // Generate unique filename
    const uniqueFileName = generateAudioFileName(originalFileName);

    // Save to local filesystem
    console.log(`Saving uploaded audio: room-${roomId}/${uniqueFileName} (${fileBuffer.byteLength} bytes)`);
    const localUrl = await saveAudioFile(fileBuffer, roomId, uniqueFileName, fileMimeType);

    // Add audio source to room
    const sources = room.addAudioSource({ url: localUrl });

    console.log(`✅ Audio upload completed - broadcasting to room ${roomId}`);

    // Broadcast to room that new audio is available
    sendBroadcast({
      server,
      roomId,
      message: {
        type: "ROOM_EVENT",
        event: {
          type: "SET_AUDIO_SOURCES",
          sources,
        },
      },
    });

    return jsonResponse({ success: true, url: localUrl });
  } catch (error) {
    console.error("Error handling upload:", error);
    return errorResponse("Failed to upload audio", 500);
  }
};
