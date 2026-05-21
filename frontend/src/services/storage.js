import AsyncStorage from "@react-native-async-storage/async-storage";
import { Directory, File, Paths } from "expo-file-system";

const SESSION_KEY_PREFIX = "sureball_session_history_v2";
const MAX_SESSION_HISTORY = 100;
const SESSION_VIDEO_DIRECTORY = new Directory(Paths.document, "sureball-session-videos");

function sessionKeyForUser(userKey) {
  return `${SESSION_KEY_PREFIX}:${String(userKey || "anonymous")}`;
}

function recordKeyFor(record) {
  return String(record?.id || `${record?.mode || "session"}-${record?.timestamp || "unknown"}`);
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
  const existing = await getLocalSessionHistory(userKey);
  const nextRecordKey = recordKeyFor(record);
  const dedupedExisting = existing.filter((item) => recordKeyFor(item) !== nextRecordKey);
  const updated = [record, ...dedupedExisting].slice(0, MAX_SESSION_HISTORY);
  const retainedUris = new Set(updated.map((item) => String(item?.localVideoUri || "").trim()).filter(Boolean));

  existing.forEach((item) => {
    const localUri = String(item?.localVideoUri || "").trim();
    if (localUri && !retainedUris.has(localUri)) {
      deleteLocalVideoUri(localUri);
    }
  });

  await AsyncStorage.setItem(sessionKeyForUser(userKey), JSON.stringify(updated));
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
