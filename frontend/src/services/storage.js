import AsyncStorage from "@react-native-async-storage/async-storage";
import { Directory, File, Paths } from "expo-file-system";

const SESSION_KEY_PREFIX = "sureball_session_history_v2";
const AUTO_SAVE_VIDEOS_KEY_PREFIX = "sureball_auto_save_videos_v1";
const SESSION_HISTORY_LIMIT_KEY_PREFIX = "sureball_session_history_limit_v1";
const RECORDING_COUNTDOWN_SECONDS_KEY_PREFIX = "sureball_recording_countdown_seconds_v1";
const RECORDING_COUNTDOWN_SOUND_KEY_PREFIX = "sureball_recording_countdown_sound_v1";
const MAX_SESSION_HISTORY = 100;
const DEFAULT_SESSION_HISTORY_LIMIT = MAX_SESSION_HISTORY;
const SESSION_HISTORY_LIMIT_OPTIONS = [10, 25, 50, 100];
const RECORDING_COUNTDOWN_OPTIONS = [0, 3, 5, 10];
const DEFAULT_RECORDING_COUNTDOWN_SECONDS = 3;
const SESSION_VIDEO_DIRECTORY = new Directory(Paths.document, "sureball-session-videos");

function sessionKeyForUser(userKey) {
  return `${SESSION_KEY_PREFIX}:${String(userKey || "anonymous")}`;
}

function autoSaveVideosKeyForUser(userKey) {
  return `${AUTO_SAVE_VIDEOS_KEY_PREFIX}:${String(userKey || "anonymous")}`;
}

function sessionHistoryLimitKeyForUser(userKey) {
  return `${SESSION_HISTORY_LIMIT_KEY_PREFIX}:${String(userKey || "anonymous")}`;
}

function recordingCountdownSecondsKeyForUser(userKey) {
  return `${RECORDING_COUNTDOWN_SECONDS_KEY_PREFIX}:${String(userKey || "anonymous")}`;
}

function recordingCountdownSoundKeyForUser(userKey) {
  return `${RECORDING_COUNTDOWN_SOUND_KEY_PREFIX}:${String(userKey || "anonymous")}`;
}

function recordKeyFor(record) {
  return String(record?.id || `${record?.mode || "session"}-${record?.timestamp || "unknown"}`);
}

function normalizeHistoryLimit(value) {
  const numericValue = Number(value);
  return SESSION_HISTORY_LIMIT_OPTIONS.includes(numericValue) ? numericValue : DEFAULT_SESSION_HISTORY_LIMIT;
}

function normalizeRecordingCountdownSeconds(value) {
  const numericValue = Number(value);
  return RECORDING_COUNTDOWN_OPTIONS.includes(numericValue) ? numericValue : DEFAULT_RECORDING_COUNTDOWN_SECONDS;
}

function sanitizePathSegment(value, fallback = "session") {
  const cleaned = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || fallback;
}

function deleteLocalVideoUri(uri) {
  const localUri = String(uri || "").trim();
  if (!localUri) {
    return;
  }

  try {
    const file = new File(localUri);
    if (file.exists) {
      file.delete();
    }
  } catch (_error) {
    // Ignore missing or inaccessible local video files during cleanup.
  }
}

function ensureSessionVideoDirectory() {
  if (!SESSION_VIDEO_DIRECTORY.exists) {
    SESSION_VIDEO_DIRECTORY.create({
      idempotent: true,
      intermediates: true,
    });
  }
}

export async function saveAnnotatedVideoLocally({ remoteUrl, sessionId, mode, timestamp, suffix = "annotated" }) {
  ensureSessionVideoDirectory();

  const fileName = [
    sanitizePathSegment(mode, "session"),
    sanitizePathSegment(sessionId || timestamp || Date.now(), "video"),
    sanitizePathSegment(suffix, "annotated"),
  ].join("-") + ".mp4";

  const destination = new File(SESSION_VIDEO_DIRECTORY, fileName);
  const downloadedFile = await File.downloadFileAsync(remoteUrl, destination, { idempotent: true });
  return downloadedFile.uri;
}

export async function saveSessionRecord(userKey, record) {
  const historyLimit = await getSessionHistoryLimitPreference(userKey);
  const existing = await getLocalSessionHistory(userKey);
  const nextRecordKey = recordKeyFor(record);
  const dedupedExisting = existing.filter((item) => recordKeyFor(item) !== nextRecordKey);
  const updated = [record, ...dedupedExisting].slice(0, historyLimit);
  const retainedUris = new Set(updated.map((item) => String(item?.localVideoUri || "").trim()).filter(Boolean));

  existing.forEach((item) => {
    const localUri = String(item?.localVideoUri || "").trim();
    if (localUri && !retainedUris.has(localUri)) {
      deleteLocalVideoUri(localUri);
    }
  });

  await AsyncStorage.setItem(sessionKeyForUser(userKey), JSON.stringify(updated));
}

export async function getAutoSaveVideosPreference(userKey) {
  const raw = await AsyncStorage.getItem(autoSaveVideosKeyForUser(userKey));
  if (raw === null) {
    return true;
  }
  return raw !== "false";
}

export async function setAutoSaveVideosPreference(userKey, enabled) {
  await AsyncStorage.setItem(autoSaveVideosKeyForUser(userKey), enabled ? "true" : "false");
}

export async function getSessionHistoryLimitPreference(userKey) {
  const raw = await AsyncStorage.getItem(sessionHistoryLimitKeyForUser(userKey));
  return normalizeHistoryLimit(raw);
}

export async function getRecordingCountdownSecondsPreference(userKey) {
  const raw = await AsyncStorage.getItem(recordingCountdownSecondsKeyForUser(userKey));
  return normalizeRecordingCountdownSeconds(raw);
}

export async function setRecordingCountdownSecondsPreference(userKey, seconds) {
  const normalizedSeconds = normalizeRecordingCountdownSeconds(seconds);
  await AsyncStorage.setItem(recordingCountdownSecondsKeyForUser(userKey), String(normalizedSeconds));
  return normalizedSeconds;
}

export async function getRecordingCountdownSoundPreference(userKey) {
  const raw = await AsyncStorage.getItem(recordingCountdownSoundKeyForUser(userKey));
  if (raw === null) {
    return true;
  }
  return raw !== "false";
}

export async function setRecordingCountdownSoundPreference(userKey, enabled) {
  await AsyncStorage.setItem(recordingCountdownSoundKeyForUser(userKey), enabled ? "true" : "false");
}

export async function setSessionHistoryLimitPreference(userKey, limit) {
  const normalizedLimit = normalizeHistoryLimit(limit);
  await AsyncStorage.setItem(sessionHistoryLimitKeyForUser(userKey), String(normalizedLimit));
  await trimLocalSessionHistory(userKey, normalizedLimit);
  return normalizedLimit;
}

export async function getLocalSessionHistory(userKey) {
  const raw = await AsyncStorage.getItem(sessionKeyForUser(userKey));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_err) {
    return [];
  }
}

export async function deleteLocalSessionRecord(userKey, sessionId, fallbackKey = null) {
  const existing = await getLocalSessionHistory(userKey);
  const removed = [];
  const updated = existing.filter((record) => {
    if (sessionId && record.id) {
      const keep = String(record.id) !== String(sessionId);
      if (!keep) {
        removed.push(record);
      }
      return keep;
    }
    if (fallbackKey) {
      const recordKey = recordKeyFor(record);
      const keep = recordKey !== fallbackKey;
      if (!keep) {
        removed.push(record);
      }
      return keep;
    }
    return true;
  });

  removed.forEach((record) => {
    deleteLocalVideoUri(record?.localVideoUri);
  });

  await AsyncStorage.setItem(sessionKeyForUser(userKey), JSON.stringify(updated));
}

export async function trimLocalSessionHistory(userKey, limit) {
  const normalizedLimit = normalizeHistoryLimit(limit);
  const existing = await getLocalSessionHistory(userKey);
  const updated = existing.slice(0, normalizedLimit);
  const retainedUris = new Set(updated.map((item) => String(item?.localVideoUri || "").trim()).filter(Boolean));

  existing.slice(normalizedLimit).forEach((record) => {
    const localUri = String(record?.localVideoUri || "").trim();
    if (localUri && !retainedUris.has(localUri)) {
      deleteLocalVideoUri(localUri);
    }
  });

  await AsyncStorage.setItem(sessionKeyForUser(userKey), JSON.stringify(updated));
}

export async function getSessionStorageStats(userKey) {
  const history = await getLocalSessionHistory(userKey);
  const uniqueVideoUris = [
    ...new Set(history.map((record) => String(record?.localVideoUri || "").trim()).filter(Boolean)),
  ];
  let savedVideoCount = 0;
  let bytes = 0;

  uniqueVideoUris.forEach((uri) => {
    try {
      const file = new File(uri);
      if (file.exists) {
        savedVideoCount += 1;
        bytes += Number(file.size || 0);
      }
    } catch (_error) {
      // Ignore stale or inaccessible files when summarizing storage.
    }
  });

  return {
    bytes,
    sessionCount: history.length,
    savedVideoCount,
  };
}

export async function clearSavedSessionVideos(userKey) {
  const existing = await getLocalSessionHistory(userKey);
  const uniqueVideoUris = [
    ...new Set(existing.map((record) => String(record?.localVideoUri || "").trim()).filter(Boolean)),
  ];

  uniqueVideoUris.forEach(deleteLocalVideoUri);

  const updated = existing.map((record) => ({
    ...record,
    localVideoUri: null,
  }));

  await AsyncStorage.setItem(sessionKeyForUser(userKey), JSON.stringify(updated));

  return {
    deletedVideoCount: uniqueVideoUris.length,
  };
}

export function formatStorageBytes(bytes) {
  const numericBytes = Number(bytes || 0);
  if (numericBytes < 1024) {
    return `${numericBytes} B`;
  }
  if (numericBytes < 1024 * 1024) {
    return `${(numericBytes / 1024).toFixed(1)} KB`;
  }
  if (numericBytes < 1024 * 1024 * 1024) {
    return `${(numericBytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(numericBytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export { RECORDING_COUNTDOWN_OPTIONS, SESSION_HISTORY_LIMIT_OPTIONS };
