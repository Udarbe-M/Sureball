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

function parseResponseJson(responseText) {
  if (!responseText) {
    return {};
  }
  try {
    return JSON.parse(responseText);
  } catch (_error) {
    return {};
  }
}

function extractErrorMessage(responseText, fallback) {
  const parsed = parseResponseJson(responseText);
  if (typeof parsed.detail === "string") {
    return parsed.detail;
  }
  if (Array.isArray(parsed.detail)) {
    return parsed.detail.map((item) => item?.msg || String(item)).join("\n");
  }
  return responseText || fallback;
}

function clampPercent(value) {
  const numericValue = Number(value || 0);
  if (!Number.isFinite(numericValue)) {
    return 0;
  }
  return Math.max(0, Math.min(Math.round(numericValue), 100));
}

function postFormDataWithProgress(path, formData, { onUploadProgress, abortSignal, errorMessage }) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;

    function rejectOnce(error) {
      if (!settled) {
        settled = true;
        reject(error);
      }
    }

    function resolveOnce(value) {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    }

    xhr.open("POST", buildUri(path));

    if (xhr.upload) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && typeof onUploadProgress === "function") {
          onUploadProgress(clampPercent((event.loaded / Math.max(event.total, 1)) * 100));
        }
      };
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onUploadProgress?.(100);
        resolveOnce(parseResponseJson(xhr.responseText));
      } else {
        rejectOnce(new Error(extractErrorMessage(xhr.responseText, errorMessage)));
      }
    };

    xhr.onerror = () => {
      rejectOnce(new Error("Network connection failed while uploading the video."));
    };

    xhr.onabort = () => {
      const abortError = new Error("Upload cancelled.");
      abortError.name = "AbortError";
      rejectOnce(abortError);
    };

    if (abortSignal) {
      if (abortSignal.aborted) {
        xhr.abort();
        return;
      }
      abortSignal.addEventListener(
        "abort",
        () => {
          xhr.abort();
        },
        { once: true }
      );
    }

    xhr.send(formData);
  });
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

export async function startShootingTraining({ videoAsset, overlayMode, testMode, userKey, onUploadProgress, abortSignal }) {
  const formData = new FormData();
  formData.append("overlay_mode", overlayMode);
  formData.append("test_mode", String(Boolean(testMode)));
  formData.append("user_key", userKey);
  formData.append("video", {
    uri: videoAsset.uri,
    name: videoAsset.name || `shooting-${Date.now()}.mp4`,
    type: videoAsset.mimeType || "video/mp4",
  });

  return postFormDataWithProgress("/shooting-training/start", formData, {
    onUploadProgress,
    abortSignal,
    errorMessage: "Unable to start shot training.",
  });
}

export async function fetchShootingTrainingStatus(fileId) {
  const response = await fetch(buildUri(`/shooting-training/status/${fileId}`));
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || "Unable to read shot training status.");
  }
  return response.json();
}

export async function cancelShootingTraining(fileId) {
  const response = await fetch(buildUri(`/shooting-training/cancel/${fileId}`), {
    method: "POST",
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || "Unable to cancel shot training.");
  }
  return response.json();
}

export function buildShootingTrainingDownloadUrl(fileId) {
  return buildUri(`/shooting-training/download/${fileId}`);
}

export async function startCoachingVideoAnalysis({ mode, videoAsset, overlayMode, testMode, userKey, onUploadProgress, abortSignal }) {
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

  return postFormDataWithProgress("/coaching-video/start", formData, {
    onUploadProgress,
    abortSignal,
    errorMessage: "Unable to start coaching video analysis.",
  });
}

export async function fetchCoachingVideoStatus(fileId) {
  const response = await fetch(buildUri(`/coaching-video/status/${fileId}`));
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || "Unable to read coaching video status.");
  }
  return response.json();
}

export async function cancelCoachingVideoAnalysis(fileId) {
  const response = await fetch(buildUri(`/coaching-video/cancel/${fileId}`), {
    method: "POST",
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || "Unable to cancel coaching video analysis.");
  }
  return response.json();
}

export function buildCoachingVideoDownloadUrl(fileId) {
  return buildUri(`/coaching-video/download/${fileId}`);
}
