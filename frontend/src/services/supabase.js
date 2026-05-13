import { createClient } from "@supabase/supabase-js";
import { HAS_SUPABASE_CONFIG, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "../config";

let supabase = null;

if (HAS_SUPABASE_CONFIG) {
  supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export function isSupabaseReady() {
  return Boolean(supabase);
}

export async function saveOrUpdateUserProfile({ name, email = null }) {
  if (!supabase) {
    return {
      persisted: false,
      source: "local-fallback",
      user: {
        name,
        email,
      },
    };
  }

  const payload = {
    name,
    email,
    last_login_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("users")
    .upsert(payload, { onConflict: "name" })
    .select("id, name, email, last_login_at")
    .single();

  if (error) {
    throw new Error(`Supabase user save failed: ${error.message}`);
  }

  return {
    persisted: true,
    source: "supabase",
    user: data,
  };
}
