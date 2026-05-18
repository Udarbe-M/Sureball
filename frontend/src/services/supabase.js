import { AppState, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import "react-native-url-polyfill/auto";
import { createClient, processLock } from "@supabase/supabase-js";
import { SUPABASE_EMAIL_REDIRECT_TO, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "../config";

const DEFAULT_PLAYER_NAME = "Student Athlete";

export function normalizePlayerName(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/\s+/g, " ");
  return normalized || DEFAULT_PLAYER_NAME;
}

export const supabase =
  SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
        auth: {
          ...(Platform.OS !== "web" ? { storage: AsyncStorage } : {}),
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: false,
          lock: processLock,
        },
      })
    : null;

if (supabase && Platform.OS !== "web") {
  AppState.addEventListener("change", (state) => {
    if (state === "active") {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}

export function isSupabaseReady() {
  return Boolean(supabase);
}

function requireSupabase() {
  if (!supabase) {
    throw new Error("Supabase is not configured. Add the project URL and publishable key first.");
  }
  return supabase;
}

function mapProfileRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    email: row.email,
    player_name: row.player_name,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function getCurrentSession() {
  const client = requireSupabase();
  const {
    data: { session },
    error,
  } = await client.auth.getSession();
  if (error) {
    throw new Error(error.message);
  }
  return session;
}

export function subscribeToAuthChanges(callback) {
  const client = requireSupabase();
  const {
    data: { subscription },
  } = client.auth.onAuthStateChange((event, session) => {
    callback(event, session);
  });

  return () => {
    subscription.unsubscribe();
  };
}

export async function signInWithEmail({ email, password }) {
  const client = requireSupabase();
  const { data, error } = await client.auth.signInWithPassword({
    email: String(email || "").trim().toLowerCase(),
    password,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function signUpWithEmail({ email, password, playerName }) {
  const client = requireSupabase();
  const options = {
    data: {
      player_name: normalizePlayerName(playerName),
    },
  };
  if (SUPABASE_EMAIL_REDIRECT_TO) {
    options.emailRedirectTo = SUPABASE_EMAIL_REDIRECT_TO;
  }

  const { data, error } = await client.auth.signUp({
    email: String(email || "").trim().toLowerCase(),
    password,
    options,
  });

  if (error) {
    throw new Error(error.message);
  }

  return {
    session: data.session,
    user: data.user,
    needsEmailVerification: !data.session,
  };
}

export async function signOutUser() {
  const client = requireSupabase();
  const { error } = await client.auth.signOut();
  if (error) {
    throw new Error(error.message);
  }
}

export async function fetchMyProfile(userId) {
  const client = requireSupabase();
  const { data, error } = await client
    .from("profiles")
    .select("id, email, player_name, created_at, updated_at")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to load player profile: ${error.message}`);
  }

  return mapProfileRow(data);
}

export async function ensureProfileForUser({ user, fallbackPlayerName }) {
  const client = requireSupabase();
  const payload = {
    id: user.id,
    email: user.email ?? null,
    player_name: normalizePlayerName(fallbackPlayerName || user.user_metadata?.player_name),
  };

  const { data, error } = await client
    .from("profiles")
    .upsert(payload, { onConflict: "id" })
    .select("id, email, player_name, created_at, updated_at")
    .single();

  if (error) {
    throw new Error(`Unable to store player profile: ${error.message}`);
  }

  return mapProfileRow(data);
}

export async function updateCurrentPlayerName(playerName) {
  const client = requireSupabase();
  const {
    data: { user },
    error: userError,
  } = await client.auth.getUser();

  if (userError) {
    throw new Error(userError.message);
  }
  if (!user) {
    throw new Error("You must be signed in to update your player name.");
  }

  const normalizedName = normalizePlayerName(playerName);
  const { data, error } = await client
    .from("profiles")
    .update({
      email: user.email ?? null,
      player_name: normalizedName,
    })
    .eq("id", user.id)
    .select("id, email, player_name, created_at, updated_at")
    .single();

  if (error) {
    throw new Error(`Unable to update player name: ${error.message}`);
  }

  const { error: authError } = await client.auth.updateUser({
    data: { player_name: normalizedName },
  });

  if (authError) {
    throw new Error(`Player name updated, but auth metadata sync failed: ${authError.message}`);
  }

  return mapProfileRow(data);
}

export async function updateCurrentPassword({ currentPassword = "", newPassword }) {
  const client = requireSupabase();
  const password = String(newPassword || "");
  const existingPassword = String(currentPassword || "");

  if (password.length < 6) {
    throw new Error("New password must be at least 6 characters.");
  }

  const payload = existingPassword
    ? {
        password,
        currentPassword: existingPassword,
      }
    : {
        password,
      };

  const { error } = await client.auth.updateUser(payload);
  if (error) {
    throw new Error(`Unable to update password: ${error.message}`);
  }

  return { updated: true };
}
