import { BACKEND_URL } from "../config";
import { mapModeToBackend } from "../utils/helpers";

function buildUri(path) {
  return `${BACKEND_URL}${path}`;
}

function withQuery(path, params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      query.set(key, String(value));
    }
  });
  const queryString = query.toString();
  return queryString ? `${path}?${queryString}` : path;
}

export async function healthCheck() {
  const response = await fetch(buildUri("/health"));
  if (!response.ok) {
    throw new Error("Backend health check failed.");
  }
  return response.json();
}

export async function analyzeFrame({ mode, photoUri, userKey }) {
  const formData = new FormData();
  formData.append("mode", mapModeToBackend(mode));
  formData.append("user_key", userKey);
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

export async function analyzeVideo({ mode, videoUri, userKey }) {
  const formData = new FormData();
  formData.append("mode", mapModeToBackend(mode));
  formData.append("user_key", userKey);
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

export async function fetchSessionsFromBackend(userKey) {
  const response = await fetch(buildUri(withQuery("/sessions", { user_key: userKey })));
  if (!response.ok) {
    return [];
  }
  return response.json();
}

export async function deleteSessionFromBackend(sessionId, userKey) {
  const response = await fetch(buildUri(withQuery(`/sessions/${sessionId}`, { user_key: userKey })), {
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

export async function startShootingTraining({ videoAsset, overlayMode, testMode, userKey }) {
  const formData = new FormData();
  formData.append("overlay_mode", overlayMode);
  formData.append("test_mode", String(Boolean(testMode)));
  formData.append("user_key", userKey);
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

export async function startCoachingVideoAnalysis({ mode, videoAsset, overlayMode, testMode, userKey }) {
  const formData = new FormData();
  formData.append("mode", mapModeToBackend(mode));
  formData.append("overlay_mode", overlayMode);
  formData.append("test_mode", String(Boolean(testMode)));
  formData.append("user_key", userKey);
  formData.append("video", {
    uri: videoAsset.uri,
    name: videoAsset.name || `coaching-${Date.now()}.mp4`,
    type: videoAsset.mimeType || "video/mp4",
  });

  const response = await fetch(buildUri("/coaching-video/start"), {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || "Unable to start coaching video analysis.");
  }

  return response.json();
}

export async function fetchCoachingVideoStatus(fileId) {
  const response = await fetch(buildUri(`/coaching-video/status/${fileId}`));
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || "Unable to read coaching video status.");
  }
  return response.json();
}

export function buildCoachingVideoDownloadUrl(fileId) {
  return buildUri(`/coaching-video/download/${fileId}`);
}
