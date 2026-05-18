export function buildUserKey({ userId = "", userProfile = null, playerName = "", playerEmail = null } = {}) {
  const resolvedUserId = String(userId || userProfile?.id || "").trim();
  if (resolvedUserId) {
    if (resolvedUserId.startsWith("guest:")) {
      return resolvedUserId;
    }
    return `supabase:${resolvedUserId}`;
  }

  const normalizedEmail = String(playerEmail || "")
    .trim()
    .toLowerCase();
  if (normalizedEmail) {
    return `email:${normalizedEmail}`;
  }

  const normalizedName = String(playerName || "Student Athlete")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  return `name:${normalizedName || "student athlete"}`;
}
