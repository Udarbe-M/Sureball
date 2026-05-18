import Constants from "expo-constants";

const fallbackUrl = "http://127.0.0.1:8000";
const fallbackSupabaseUrl = "";
const fallbackSupabasePublishableKey = "";
const envBackendUrl = process.env.EXPO_PUBLIC_BACKEND_URL || "";
const envSupabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const envSupabasePublishableKey =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";
const envSupabaseEmailRedirectTo = process.env.EXPO_PUBLIC_SUPABASE_EMAIL_REDIRECT_TO || "";

function readExtra(key, fallback = "") {
  return (
    Constants.expoConfig?.extra?.[key] ||
    Constants.manifest2?.extra?.expoClient?.extra?.[key] ||
    fallback
  );
}

export const BACKEND_URL = envBackendUrl || readExtra("backendUrl", fallbackUrl);
export const SUPABASE_URL = envSupabaseUrl || readExtra("supabaseUrl", fallbackSupabaseUrl);
export const SUPABASE_PUBLISHABLE_KEY = envSupabasePublishableKey || readExtra(
  "supabasePublishableKey",
  readExtra("supabaseAnonKey", fallbackSupabasePublishableKey)
);
export const SUPABASE_EMAIL_REDIRECT_TO =
  envSupabaseEmailRedirectTo || readExtra("supabaseEmailRedirectTo", "");
export const HAS_SUPABASE_CONFIG = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
