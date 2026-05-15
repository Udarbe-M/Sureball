import { BACKEND_URL } from "../config";
import { mapModeToBackend } from "../utils/helpers";

function buildUri(path) {
  return `${BACKEND_URL}${path}`;
}

export async function healthCheck() {
  const response = await fetch(buildUri("/health"));
  if (!response.ok) {
    throw new Error("Backend health check failed.");
  }
  return response.json();
}

export async function analyzeFrame({ mode, photoUri }) {
  const formData = new FormData();
  formData.append("mode", mapModeToBackend(mode));
  formData.append("frame", {
    uri: photoUri,
    name: `frame-${Date.now()}.jpg`,
    type: "image/jpeg",
  });

  const response = await fetch(buildUri("/analyze-frame"), {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || "Frame analysis failed.");
  }
  return response.json();
}

export async function analyzeVideo({ mode, videoUri }) {
  const formData = new FormData();
  formData.append("mode", mapModeToBackend(mode));
  formData.append("sample_stride", "5");
  formData.append("video", {
    uri: videoUri,
    name: `session-${Date.now()}.mp4`,
    type: "video/mp4",
  });

  const response = await fetch(buildUri("/analyze-video"), {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || "Video analysis failed.");
  }
  return response.json();
}

export async function fetchSessionsFromBackend() {
  const response = await fetch(buildUri("/sessions"));
  if (!response.ok) {
    return [];
  }
  return response.json();
}

export async function deleteSessionFromBackend(sessionId) {
  const response = await fetch(buildUri(`/sessions/${sessionId}`), {
    method: "DELETE",
  });

  if (response.status === 404) {
    return { status: "not_found", session_id: sessionId };
  }

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || "Unable to delete session.");
  }

  return response.json();
}

export async function startShootingTraining({ videoAsset, overlayMode, testMode }) {
  const formData = new FormData();
  formData.append("overlay_mode", overlayMode);
  formData.append("test_mode", String(Boolean(testMode)));
  formData.append("video", {
    uri: videoAsset.uri,
    name: videoAsset.name || `shooting-${Date.now()}.mp4`,
    type: videoAsset.mimeType || "video/mp4",
  });

  const response = await fetch(buildUri("/shooting-training/start"), {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || "Unable to start shot training.");
  }

  return response.json();
}

export async function fetchShootingTrainingStatus(fileId) {
  const response = await fetch(buildUri(`/shooting-training/status/${fileId}`));
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || "Unable to read shot training status.");
  }
  return response.json();
}

export function buildShootingTrainingDownloadUrl(fileId) {
  return buildUri(`/shooting-training/download/${fileId}`);
}
