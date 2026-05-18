import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  ensureProfileForUser,
  fetchMyProfile,
  getCurrentSession,
  isSupabaseReady,
  normalizePlayerName,
  signInWithEmail,
  signOutUser,
  signUpWithEmail,
  subscribeToAuthChanges,
  updateCurrentPassword,
  updateCurrentPlayerName,
} from "../services/supabase";

const AuthContext = createContext(null);
const GUEST_SESSION_KEY = "sureball_guest_session_v1";

function buildFallbackName(session, profile) {
  if (profile?.player_name) {
    return profile.player_name;
  }
  if (session?.user?.user_metadata?.player_name) {
    return normalizePlayerName(session.user.user_metadata.player_name);
  }
  if (session?.user?.email) {
    return normalizePlayerName(session.user.email.split("@")[0]);
  }
  return "Student Athlete";
}

function buildGuestSession({ id, playerName, createdAt }) {
  return {
    type: "guest",
    id,
    email: null,
    player_name: normalizePlayerName(playerName),
    created_at: createdAt || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

async function readGuestSession() {
  const raw = await AsyncStorage.getItem(GUEST_SESSION_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed?.id) {
      return null;
    }
    return buildGuestSession({
      id: parsed.id,
      playerName: parsed.player_name,
      createdAt: parsed.created_at,
    });
  } catch (_error) {
    return null;
  }
}

async function writeGuestSession(guestSession) {
  await AsyncStorage.setItem(GUEST_SESSION_KEY, JSON.stringify(guestSession));
}

async function clearGuestSession() {
  await AsyncStorage.removeItem(GUEST_SESSION_KEY);
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [guestProfile, setGuestProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;

    async function syncSession(nextSession) {
      if (!alive) {
        return;
      }

      if (!nextSession?.user) {
        setSession(null);
        setProfile(null);
        return;
      }

      setSession(nextSession);
      setGuestProfile(null);

      try {
        let nextProfile = await fetchMyProfile(nextSession.user.id);
        const expectedEmail = nextSession.user.email ?? null;
        const fallbackName = buildFallbackName(nextSession, nextProfile);

        if (!nextProfile || nextProfile.email !== expectedEmail) {
          nextProfile = await ensureProfileForUser({
            user: nextSession.user,
            fallbackPlayerName: fallbackName,
          });
        }

        if (!alive) {
          return;
        }
        setProfile(nextProfile);
      } catch (profileError) {
        if (!alive) {
          return;
        }
        setError(String(profileError.message || profileError));
        setProfile(null);
      } finally {
        if (alive) {
          setLoading(false);
        }
      }
    }

    async function hydrateGuestProfile() {
      const storedGuest = await readGuestSession();
      if (!alive || !storedGuest) {
        return false;
      }
      setGuestProfile(storedGuest);
      setLoading(false);
      return true;
    }

    async function bootstrap() {
      if (!isSupabaseReady()) {
        await hydrateGuestProfile();
        setLoading(false);
        return;
      }

      try {
        const currentSession = await getCurrentSession();
        if (currentSession?.user) {
          await syncSession(currentSession);
          return;
        }

        const hasGuestProfile = await hydrateGuestProfile();
        if (!hasGuestProfile && alive) {
          setSession(null);
          setProfile(null);
          setGuestProfile(null);
          setLoading(false);
        }
      } catch (sessionError) {
        if (!alive) {
          return;
        }
        const hasGuestProfile = await hydrateGuestProfile();
        if (!hasGuestProfile) {
          setError(String(sessionError.message || sessionError));
        }
        setLoading(false);
      }
    }

    bootstrap();

    let unsubscribe = () => {};
    if (isSupabaseReady()) {
      unsubscribe = subscribeToAuthChanges(async (_event, nextSession) => {
        if (!nextSession?.user) {
          setSession(null);
          setProfile(null);
          const hasGuestProfile = await readGuestSession();
          setGuestProfile(hasGuestProfile);
          setLoading(false);
          return;
        }

        setGuestProfile(null);
        await syncSession(nextSession);
      });
    }

    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  const value = useMemo(
    () => ({
      loading,
      error,
      clearError: () => setError(""),
      session,
      user: session?.user ?? null,
      profile: profile || guestProfile,
      isGuest: Boolean(guestProfile?.id) && !session?.user,
      isAuthenticated: Boolean(session?.user || guestProfile?.id),
      playerName: guestProfile?.player_name || buildFallbackName(session, profile),
      playerEmail: session?.user?.email ?? profile?.email ?? null,
      userId: session?.user?.id ?? profile?.id ?? guestProfile?.id ?? null,
      async signIn({ email, password }) {
        setError("");
        await clearGuestSession();
        setGuestProfile(null);
        return signInWithEmail({ email, password });
      },
      async signUp({ email, password, playerName, asGuest = false }) {
        setError("");
        if (asGuest) {
          const nextGuestProfile = buildGuestSession({
            id: `guest:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
            playerName,
          });
          await clearGuestSession();
          await writeGuestSession(nextGuestProfile);
          setSession(null);
          setProfile(null);
          setGuestProfile(nextGuestProfile);
          return {
            session: null,
            user: null,
            needsEmailVerification: false,
            guest: true,
          };
        }

        const result = await signUpWithEmail({ email, password, playerName });

        if (result.session?.user) {
          const nextProfile = await ensureProfileForUser({
            user: result.session.user,
            fallbackPlayerName: playerName,
          });
          setSession(result.session);
          setProfile(nextProfile);
          setGuestProfile(null);
          await clearGuestSession();
        }

        return result;
      },
      async signOut() {
        setError("");
        if (guestProfile?.id && !session?.user) {
          await clearGuestSession();
          setGuestProfile(null);
          setSession(null);
          setProfile(null);
          return;
        }
        await signOutUser();
        setSession(null);
        setProfile(null);
        setGuestProfile(null);
      },
      async updatePlayerName(nextPlayerName) {
        setError("");
        if (guestProfile?.id && !session?.user) {
          const updatedGuestProfile = buildGuestSession({
            id: guestProfile.id,
            playerName: nextPlayerName,
            createdAt: guestProfile.created_at,
          });
          await writeGuestSession(updatedGuestProfile);
          setGuestProfile(updatedGuestProfile);
          return updatedGuestProfile;
        }
        const updatedProfile = await updateCurrentPlayerName(nextPlayerName);
        setProfile(updatedProfile);
        return updatedProfile;
      },
      async changePassword({ currentPassword, newPassword }) {
        setError("");
        if (guestProfile?.id && !session?.user) {
          throw new Error("Guest users do not have a password to change.");
        }
        return updateCurrentPassword({ currentPassword, newPassword });
      },
      async refreshProfile() {
        if (!session?.user) {
          return null;
        }
        const nextProfile = await fetchMyProfile(session.user.id);
        setProfile(nextProfile);
        return nextProfile;
      },
    }),
    [error, guestProfile, loading, profile, session]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider.");
  }
  return context;
}
