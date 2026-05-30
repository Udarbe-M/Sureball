export function mapModeToBackend(modeId) {
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
