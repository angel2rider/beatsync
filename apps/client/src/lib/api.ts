import { DiscoverRoomsType, GetActiveRoomsType, GetDefaultAudioType } from "@beatsync/shared";
import { getApiUrl } from "./urls";

export const uploadAudioFile = async (data: { file: File; roomId: string }) => {
  try {
    // Direct multipart upload to server
    const formData = new FormData();
    formData.append("file", data.file);
    formData.append("roomId", data.roomId);

    const uploadResponse = await fetch(`${getApiUrl()}/upload`, {
      method: "POST",
      body: formData,
    });

    if (!uploadResponse.ok) {
      const errorData = await uploadResponse.json().catch(() => null);
      throw new Error(errorData?.message || `Upload failed: ${uploadResponse.statusText}`);
    }

    const result = await uploadResponse.json();

    return {
      success: true,
      publicUrl: result.url,
    };
  } catch (error) {
    throw error;
  }
};

export const fetchAudio = async (url: string) => {
  try {
    // Fetch from local server
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch audio: ${response.statusText}`);
    }

    return await response.blob();
  } catch (error) {
    throw new Error(`Failed to fetch audio: ${error}`);
  }
};

export async function fetchDefaultAudioSources() {
  try {
    const response = await fetch(`${getApiUrl()}/default`);

    if (!response.ok) {
      console.error("Failed to fetch default audio sources:", response.status);
      return [];
    }

    const files: GetDefaultAudioType = await response.json();
    return files;
  } catch (error) {
    console.error("Error fetching default audio sources:", error);
    return [];
  }
}

export async function fetchActiveRooms() {
  const response = await fetch(`${getApiUrl()}/active-rooms`);
  const data: GetActiveRoomsType = await response.json();
  return data;
}

export async function fetchDiscoverRooms() {
  const response = await fetch(`${getApiUrl()}/discover`);
  const data: DiscoverRoomsType = await response.json();
  return data;
}
