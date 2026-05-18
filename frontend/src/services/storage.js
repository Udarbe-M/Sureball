import AsyncStorage from "@react-native-async-storage/async-storage";

const SESSION_KEY_PREFIX = "sureball_session_history_v2";

function sessionKeyForUser(userKey) {
  return `${SESSION_KEY_PREFIX}:${String(userKey || "anonymous")}`;
}

export async function saveSessionRecord(userKey, record) {
  const existing = await getLocalSessionHistory(userKey);
  const updated = [record, ...existing].slice(0, 100);
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
  const updated = existing.filter((record) => {
    if (sessionId && record.id) {
      return String(record.id) !== String(sessionId);
    }
    if (fallbackKey) {
      const recordKey = record.id || `${record.mode}-${record.timestamp}`;
      return recordKey !== fallbackKey;
    }
    return true;
  });
  await AsyncStorage.setItem(sessionKeyForUser(userKey), JSON.stringify(updated));
}
