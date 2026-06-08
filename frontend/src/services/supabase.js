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

function mapAuthError(error) {
  const message = String(error?.message || error || "").trim();

  if (/email not confirmed/i.test(message) || /confirm.*email/i.test(message)) {
    return new Error(
      "This account exists, but Supabase is still blocking sign-in until the email is verified."
    );
  }

  if (/email address .* not authorized/i.test(message)) {
    return new Error(
      "This Supabase project is still using the default email sender. Verification emails only go to project team addresses until custom SMTP is configured."
    );
  }

  if (/rate limit/i.test(message) || /too many requests/i.test(message)) {
    return new Error(
      "Supabase temporarily blocked another auth email. Wait a moment and try again, or check the project's SMTP and rate-limit settings."
    );
  }

  return new Error(message || "Supabase authentication failed.");
}

function isEmailNotConfirmedError(error) {
  const message = String(error?.message || error || "").trim();
  return /email not confirmed/i.test(message) || /confirm.*email/i.test(message);
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
    throw mapAuthError(error);
  }

  return data;
}

export async function signUpWithEmail({ email, password, playerName }) {
  const client = requireSupabase();
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const options = {
    data: {
      player_name: normalizePlayerName(playerName),
    },
  };
  if (SUPABASE_EMAIL_REDIRECT_TO) {
    options.emailRedirectTo = SUPABASE_EMAIL_REDIRECT_TO;
  }

  const { data, error } = await client.auth.signUp({
    email: normalizedEmail,
    password,
    options,
  });

  if (error) {
    throw mapAuthError(error);
  }

  if (!data.session) {
    const { data: signInData, error: signInError } = await client.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    });

    if (signInError) {
      if (isEmailNotConfirmedError(signInError)) {
        return {
          session: null,
          user: data.user,
          needsEmailVerification: true,
          signInBlockedUntilVerified: true,
          signInBlockedMessage:
            "Account created, but this Supabase project still requires email verification before sign-in.",
        };
      }

      throw mapAuthError(signInError);
    }

    return {
      session: signInData.session,
      user: signInData.user || data.user,
      needsEmailVerification: !signInData.session,
      signedInAfterSignup: Boolean(signInData.session),
    };
  }

  return {
    session: data.session,
    user: data.user,
    needsEmailVerification: false,
    signedInAfterSignup: true,
  };
}

export async function resendSignupVerification(email) {
  const client = requireSupabase();
  const payload = {
    type: "signup",
    email: String(email || "").trim().toLowerCase(),
  };

  if (SUPABASE_EMAIL_REDIRECT_TO) {
    payload.options = {
      emailRedirectTo: SUPABASE_EMAIL_REDIRECT_TO,
    };
  }

  const { error } = await client.auth.resend(payload);
  if (error) {
    throw mapAuthError(error);
  }

  return { resent: true };
}

export async function signOutUser() {
  const client = requireSupabase();
  const { error } = await client.auth.signOut();
  if (error) {
    throw mapAuthError(error);
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
    throw new Error(`Unable to update password: ${mapAuthError(error).message}`);
  }

  return { updated: true };
}
