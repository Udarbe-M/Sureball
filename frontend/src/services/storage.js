import AsyncStorage from "@react-native-async-storage/async-storage";

const SESSION_KEY = "sureball_session_history_v1";

export async function saveSessionRecord(record) {
  const existing = await getLocalSessionHistory();
  const updated = [record, ...existing].slice(0, 100);
  await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(updated));
}

export async function getLocalSessionHistory() {
  const raw = await AsyncStorage.getItem(SESSION_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_err) {
    return [];
  }
}
