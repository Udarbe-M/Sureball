const MODE_GUIDES = {
  shooting_form: {
    modeId: "shooting_form",
    modeTitle: "Shooting",
    title: "Shooting Setup",
    tips: [
      "Keep the player, ball, hoop, and landing visible.",
      "Use a side or front angle with the full body in frame.",
      "Avoid zooming during the release and hoop entry.",
    ],
    poseCardTitle: "Form That Scores Higher",
    poseHeadline: "Match this shape before the release so SureBall can read your setup and follow-through clearly.",
    poseCues: [
      "Keep the elbow stacked under the ball.",
      "Start from a balanced base with bent knees.",
      "Let the guide hand stay to the side, not behind the ball.",
      "Finish with a soft wrist snap and balanced landing.",
    ],
    image: require("../../assets/reference-poses/shooting-optimal.png"),
    imageAlt: "Ideal basketball shooting form illustration",
    motionGuide: {
      phases: [
        {
          id: "start",
          label: "Start",
          cue: "Load from a balanced base with bent knees and the ball stacked over the shooting elbow.",
          transform: { scale: 1.02, translateX: -6, translateY: 10 },
        },
        {
          id: "finish",
          label: "Finish",
          cue: "Rise into the release, snap the wrist softly, and land balanced in the same shooting lane.",
          transform: { scale: 1.08, translateX: 6, translateY: -8 },
        },
      ],
    },
    fullGuideTitle: "Shooting Full Guide",
    fullGuideIntro: "Use this as the target shape before you chase a higher score. The cleaner the setup, the easier the release is to repeat.",
    keyCues: [
      "Load through the knees so the shot starts from the ground up.",
      "Keep the shooting elbow close to the body line instead of flaring wide.",
      "Bring the ball up on one smooth path without drifting across the face.",
      "Hold the follow-through with fingers down and shoulders balanced.",
    ],
    commonMistakes: [
      "Guide hand pushing the ball sideways.",
      "Falling backward or drifting on the release.",
      "Elbow flaring away from the shooting line.",
      "Rushing the shot without full knee load.",
    ],
    scoringNotes: [
      "SureBall scores visible setup, balance, and follow-through cues from the body pose.",
      "A clear side or front angle helps the app read elbow line, knee bend, and landing balance.",
      "The ball and hoop still matter for shot result tracking, but the technique score comes mainly from the pose.",
    ],
    practiceFocus: [
      "Do 10 slow form shots while holding the follow-through for one second.",
      "Record from the same angle each time so you can compare setup and landing.",
    ],
    beginnerGuide: [
      "Start close to the basket so you can focus on form instead of power.",
      "Bend your knees before the ball rises.",
      "Keep your elbow under the ball and finish with your wrist relaxed.",
    ],
    intermediateGuide: [
      "Check that the ball moves up on one line instead of crossing your face.",
      "Keep the guide hand quiet and release without pushing sideways.",
      "Land balanced in the same lane you jumped from.",
    ],
  },
  dribbling: {
    modeId: "dribbling",
    modeTitle: "Dribbling",
    title: "Dribbling Setup",
    tips: [
      "Show the full body, both hands, and the ball bounce.",
      "Keep the phone far enough to see knees, hips, and feet.",
      "Use steady lighting so fast ball movement stays visible.",
    ],
    poseCardTitle: "Form That Scores Higher",
    poseHeadline: "Start from a low athletic stance so SureBall can read control, balance, and hand position frame by frame.",
    poseCues: [
      "Stay low with knees bent and chest up.",
      "Keep the dribble at knee-to-hip height for control.",
      "Use the off-hand to protect, not to grab.",
      "Keep weight centered instead of rocking side to side.",
    ],
    image: require("../../assets/reference-poses/dribbling-optimal.png"),
    imageAlt: "Ideal basketball dribbling stance illustration",
    motionGuide: {
      phases: [
        {
          id: "start",
          label: "Start",
          cue: "Begin low with hips dropped, chest up, and the ball controlled below the hip line.",
          transform: { scale: 1.02, translateX: -8, translateY: 12 },
        },
        {
          id: "finish",
          label: "Finish",
          cue: "Meet the ball early after the bounce and keep the next dribble close to the body with steady balance.",
          transform: { scale: 1.07, translateX: 8, translateY: -6 },
        },
      ],
    },
    fullGuideTitle: "Dribbling Full Guide",
    fullGuideIntro: "The goal is controlled movement, not just speed. A lower, quieter stance usually gives a steadier score and cleaner review video.",
    keyCues: [
      "Sit the hips down so the ball can stay below the defender's reach.",
      "Control the ball with fingertips instead of slapping with the palm.",
      "Keep the off-hand active for protection while the shoulders stay level.",
      "Move the feet under the body so balance stays steady during each bounce.",
    ],
    commonMistakes: [
      "Standing too tall and letting the ball rise too high.",
      "Looking down at the ball for every bounce.",
      "Pounding the ball without control or rhythm.",
      "Leaning too hard to one side and losing balance.",
    ],
    scoringNotes: [
      "SureBall reads stance, body balance, and ball-to-hand control windows across the clip.",
      "A wider camera angle helps the app see the knees, hips, and bounce path together.",
      "Faster dribbles can still score well if the body stays low and controlled.",
    ],
    practiceFocus: [
      "Do 20 controlled low dribbles per hand while keeping the chest up.",
      "Record from the front or front-side angle so stance and bounce height are easy to compare.",
    ],
    beginnerGuide: [
      "Keep your knees bent and the ball below your hip.",
      "Use your fingertips to control the bounce.",
      "Keep your eyes up for a few bounces at a time.",
    ],
    intermediateGuide: [
      "Keep your shoulders level while changing speed.",
      "Use your off-hand to protect space without grabbing the ball.",
      "Keep the ball close enough that your hand meets it early after each bounce.",
    ],
  },
  passing: {
    modeId: "passing",
    modeTitle: "Passing",
    title: "Passing Setup",
    tips: [
      "Show hands, ball, chest, and target direction.",
      "Use a side or front angle that catches the release.",
      "Keep the body balanced in frame after the pass.",
    ],
    poseCardTitle: "Form That Scores Higher",
    poseHeadline: "Show a strong base and clean extension so SureBall can read the pass line, release shape, and finish.",
    poseCues: [
      "Bring the ball to the chest before the pass.",
      "Step toward the target as the arms extend.",
      "Snap the wrists out through the pass line.",
      "Stay upright instead of leaning off-balance.",
    ],
    image: require("../../assets/reference-poses/passing-optimal.png"),
    imageAlt: "Ideal basketball chest pass illustration",
    motionGuide: {
      phases: [
        {
          id: "start",
          label: "Start",
          cue: "Start with the ball at the chest and the body loaded so the step supports the pass.",
          transform: { scale: 1.02, translateX: -6, translateY: 8 },
        },
        {
          id: "finish",
          label: "Finish",
          cue: "Step through the target line, extend both arms, and finish with wrists snapped toward the receiver.",
          transform: { scale: 1.08, translateX: 8, translateY: -8 },
        },
      ],
    },
    fullGuideTitle: "Passing Full Guide",
    fullGuideIntro: "A good pass is direct, balanced, and repeatable. SureBall scores best when the body shape and release line stay clear through the pass.",
    keyCues: [
      "Start with the ball centered at the chest so the pass path stays direct.",
      "Step into the pass so the lower body supports the release.",
      "Extend both arms fully toward the target with wrists snapping out.",
      "Finish balanced instead of twisting away after release.",
    ],
    commonMistakes: [
      "Throwing from the shoulder instead of the chest.",
      "Passing flat-footed with no step into the target.",
      "Opening the body too early and drifting offline.",
      "Dropping the hands immediately after release.",
    ],
    scoringNotes: [
      "SureBall looks for the pass line, hand extension, and body balance after release.",
      "The cleaner the release angle, the easier it is for the app to separate technique from camera noise.",
      "Keeping the target direction visible improves the quality of the pass review.",
    ],
    practiceFocus: [
      "Do 10 chest passes while freezing the finish for one beat.",
      "Record from a front-side angle that shows both the step and the extension line.",
    ],
    beginnerGuide: [
      "Start with the ball at your chest.",
      "Step toward the target as you pass.",
      "Finish with both hands pointing where the ball should go.",
    ],
    intermediateGuide: [
      "Keep the pass line straight from chest to target.",
      "Use the step to transfer body weight into the pass.",
      "Hold balance after release instead of twisting away.",
    ],
  },
};

export function getModeGuide(modeId) {
  return MODE_GUIDES[modeId] || MODE_GUIDES.shooting_form;
}

export { MODE_GUIDES };
