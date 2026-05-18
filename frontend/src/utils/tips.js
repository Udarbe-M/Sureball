const DAILY_TIPS = [
  {
    title: "Balance First",
    body: "Start each rep with your feet set and your chest quiet. Clean balance usually fixes several form issues at once.",
  },
  {
    title: "Eyes Up",
    body: "Keep your eyes level through the motion. A steady head position helps both shooting rhythm and defensive readiness.",
  },
  {
    title: "Stay In Frame",
    body: "Give the camera your full body whenever possible. Better framing means better pose tracking and more useful feedback.",
  },
  {
    title: "Short Clips Win",
    body: "Use shorter test clips first to validate your angle, then run the full drill once the tracking looks clean.",
  },
  {
    title: "Load The Legs",
    body: "Whether you are shooting or moving, bend into the floor a little earlier so your power starts from the base.",
  },
  {
    title: "Protect The Ball",
    body: "Keep the ball close to your frame during movement drills. Wide carries make the feedback harsher and the rep less game-ready.",
  },
  {
    title: "Review One Cue",
    body: "After each session, pick just one correction to attack next. Small focused changes tend to stick better than full resets.",
  },
];

function daySeed(date = new Date()) {
  const year = date.getFullYear();
  const start = new Date(year, 0, 0);
  const diff = date - start;
  const oneDay = 1000 * 60 * 60 * 24;
  return Math.floor(diff / oneDay);
}

export function getDailyTip(date = new Date()) {
  const index = daySeed(date) % DAILY_TIPS.length;
  return DAILY_TIPS[index];
}
