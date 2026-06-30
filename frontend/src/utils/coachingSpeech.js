function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function endSentence(value) {
  const text = cleanText(value);
  if (!text) {
    return "";
  }
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

export function buildCoachingSpeech({
  modeLabel = "coaching",
  score,
  classification,
  feedback = [],
  summary,
  stats,
}) {
  const parts = [];
  const numericScore = Number(score);
  const grade = cleanText(classification);

  if (Number.isFinite(numericScore)) {
    parts.push(
      `Your ${cleanText(modeLabel) || "coaching"} result is ${numericScore.toFixed(1)}${grade ? `, rated ${grade}` : ""}.`
    );
  } else if (grade) {
    parts.push(`Your ${cleanText(modeLabel) || "coaching"} result is rated ${grade}.`);
  }

  if (stats && Number(stats.attempts || 0) > 0) {
    parts.push(
      `${Number(stats.makes || 0)} made out of ${Number(stats.attempts || 0)} attempts, with ${Number(
        stats.accuracy || 0
      ).toFixed(1)} percent accuracy.`
    );
  }

  const cues = [...new Set((Array.isArray(feedback) ? feedback : []).map(cleanText).filter(Boolean))].slice(0, 3);
  if (cues.length > 0) {
    parts.push(`Coaching focus. ${cues.map(endSentence).join(" ")}`);
  } else if (cleanText(summary)) {
    parts.push(`Coaching summary. ${endSentence(summary)}`);
  } else {
    parts.push("Review the visual overlays in the processed video for your coaching feedback.");
  }

  return parts.join(" ");
}
