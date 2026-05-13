import Constants from "expo-constants";

const fallbackUrl = "http://127.0.0.1:8000";
const fallbackSupabaseUrl = "";
const fallbackSupabasePublishableKey = "";

function readExtra(key, fallback = "") {
  return (
    Constants.expoConfig?.extra?.[key] ||
    Constants.manifest2?.extra?.expoClient?.extra?.[key] ||
    fallback
  );
}

export const BACKEND_URL = readExtra("backendUrl", fallbackUrl);
export const SUPABASE_URL = readExtra("supabaseUrl", fallbackSupabaseUrl);
export const SUPABASE_PUBLISHABLE_KEY = readExtra(
  "supabasePublishableKey",
  readExtra("supabaseAnonKey", fallbackSupabasePublishableKey)
);
export const HAS_SUPABASE_CONFIG = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
