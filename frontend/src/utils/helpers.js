export function mapModeToBackend(modeId) {
  if (modeId === "footwork") {
    return "basic_footwork";
  }
  return modeId;
}

export function humanizeMode(modeId) {
  if (!modeId) return "";
  return modeId
    .replace("basic_", "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

export function normalizeClassification(label) {
  return label || "Needs Improvement";
}
