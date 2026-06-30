import { useEvent } from "expo";
import { Feather } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useAudioPlayer } from "expo-audio";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as DocumentPicker from "expo-document-picker";
import * as ScreenOrientation from "expo-screen-orientation";
import * as Speech from "expo-speech";
import { VideoView, useVideoPlayer } from "expo-video";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  PanResponder,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import BrandMark from "../components/BrandMark";
import CorePoseTutorialVideo from "../components/CorePoseTutorialVideo";
import PrimaryButton from "../components/PrimaryButton";
import { useAuth } from "../context/AuthContext";
import { getModeGuide } from "../data/modeGuides";
import {
  buildCoachingVideoDownloadUrl,
  cancelCoachingVideoAnalysis,
  fetchCoachingVideoStatus,
  healthCheck,
  startCoachingVideoAnalysis,
} from "../services/api";
import { Haptics, hapticImpact, hapticSelection, hapticSuccess, hapticWarning } from "../services/haptics";
import { archiveCompletedSession } from "../services/sessionArchive";
import {
  getAppGuideSeenPreference,
  getRecordingCountdownSecondsPreference,
  getRecordingCountdownSoundPreference,
  setAppGuideSeenPreference,
} from "../services/storage";
import { colors } from "../theme/colors";
import { COUNTDOWN_BEEP_SOURCE, COUNTDOWN_START_BUZZER_SOURCE, wait } from "../utils/countdown";
import { buildCoachingSpeech } from "../utils/coachingSpeech";
import { buildUserKey } from "../utils/userKey";

const MODES = [
  {
    id: "shooting_form",
    title: "Shooting",
    tag: "Shot",
    description: "Review elbow line, comfortable base, ball release, and balance.",
    guideLabel: "Shooting Form",
    guideHint: "Elbow, base, release",
    guideIcon: "target",
  },
  {
    id: "dribbling",
    title: "Dribbling",
    tag: "Handle",
    description: "Track low handle position, visible ball path, stance, and balance.",
    guideLabel: "Dribble Control",
    guideHint: "Stance, height, rhythm",
    guideIcon: "activity",
  },
  {
    id: "passing",
    title: "Passing",
    tag: "Pass",
    description: "Check passing line, visible ball path, release window, and body control.",
    guideLabel: "Passing Line",
    guideHint: "Step, release, finish",
    guideIcon: "send",
  },
];

const COACHING_OVERLAY_OPTIONS = [
  {
    id: "full_overlay",
    title: "Full Overlay",
    description: "Show tracking details, detection boxes, coaching cues, score, and counts.",
  },
  {
    id: "focus_feedback",
    title: "Focus",
    description: "Show the main coaching cue, score, tracking status, and counts without detection boxes.",
  },
  {
    id: "score_only",
    title: "Score",
    description: "Show only the score/classification and drill count results.",
  },
];

const REVIEW_LEVELS = [
  { id: "beginner", title: "Beginner" },
  { id: "intermediate", title: "Intermediate" },
];

const COLLAPSED_SHEET_HEIGHT_ESTIMATE = 108;
const SHEET_TOP_OVERLAP = 20;
const SOURCE_ORIENTATION_OPTIONS = [
  { id: "auto", title: "Auto" },
  { id: "portrait", title: "Portrait" },
  { id: "landscape", title: "Landscape" },
];

const APP_GUIDE_STEPS = [
  {
    id: "menu",
    target: "menuButton",
    title: "Training Menu",
    body: "Open quick controls, Settings, this Guide, camera power, and the full drill guides.",
  },
  {
    id: "modeBadge",
    target: "modeBadge",
    title: "Current Drill",
    body: "This shows the active drill and output style before you record or upload a clip.",
  },
  {
    id: "record",
    target: "recordButton",
    title: "Record",
    body: "Tap here to start the countdown and record your drill. Tap again to stop recording.",
  },
  {
    id: "history",
    target: "historyButton",
    title: "Session History",
    body: "Open your archived sessions and replay saved annotated videos.",
  },
  {
    id: "cameraSwitch",
    target: "cameraSwitchButton",
    title: "Camera Switch",
    body: "Change between the back and front camera before recording.",
  },
  {
    id: "sheetHandle",
    target: "sheetHandle",
    title: "Training Card",
    body: "Drag this card up or down to show or hide mode, output, upload, and analysis controls.",
  },
  {
    id: "modePicker",
    target: "modePicker",
    title: "Mode Picker",
    body: "Choose Shooting, Dribbling, or Passing before analyzing the clip.",
    requiresSheet: true,
  },
  {
    id: "outputPicker",
    target: "outputPicker",
    title: "Output Style",
    body: "Use Focus for coaching, Full Overlay for tracking details, or Score for a simple result.",
    requiresSheet: true,
  },
  {
    id: "clipActions",
    target: "clipActions",
    title: "Upload and Analyze",
    body: "Use Upload Clip for saved videos, then Analyze when the clip is ready.",
    requiresSheet: true,
    scrollTarget: "clipActions",
  },
];

const INITIAL_COACHING_RESULTS = {
  analyzedFrames: 0,
  poseFrames: 0,
  ballFrames: 0,
  poseDetectionRate: 0,
  ballDetectionRate: 0,
  averageScore: 0,
  bestScore: 0,
  worstScore: 0,
  actionCount: 0,
  actionLabel: "",
  shootingStats: { attempts: 0, makes: 0, misses: 0, accuracy: 0 },
  shotEvents: [],
  classification: "",
  summary: "",
  dominantFeedback: [],
  poseComparison: [],
  phaseScores: [],
  inputWidth: 0,
  inputHeight: 0,
  outputWidth: 0,
  outputHeight: 0,
  inputOrientation: "unknown",
  outputOrientation: "unknown",
};

function clampPercent(value) {
  const numericValue = Number(value || 0);
  if (!Number.isFinite(numericValue)) {
    return 0;
  }
  return Math.max(0, Math.min(Math.round(numericValue), 100));
}

function clampValue(value, min, max) {
  return Math.max(min, Math.min(value, max));
}

function buildScoreExplanation({ activeMode, results }) {
  const topCue = results.dominantFeedback?.[0] || "No major focus area detected yet.";
  const actionText = results.actionLabel
    ? `${results.actionCount || 0} ${String(results.actionLabel).toLowerCase()} counted`
    : "Technique score based on tracked form cues";
  const shootingText =
    activeMode.id === "shooting_form"
      ? `Shooting: ${results.shootingStats?.makes || 0}/${results.shootingStats?.attempts || 0} makes, ${Number(
          results.shootingStats?.accuracy || 0
        ).toFixed(1)}% accuracy`
      : actionText;

  return [
    { label: "Score", value: `${Number(results.averageScore || 0).toFixed(1)} ${results.classification || ""}`.trim() },
    { label: "Tracking", value: `${Number(results.poseDetectionRate || 0).toFixed(1)}% pose, ${Number(results.ballDetectionRate || 0).toFixed(1)}% ball` },
    { label: "Action", value: shootingText },
    { label: "Scoring Basis", value: "Frame-by-frame average; phase cards are diagnostic only." },
    { label: "Main cue", value: topCue },
  ];
}

function buildScoreReasons({ activeMode, results }) {
  const reasons = [];
  const score = Number(results.averageScore || 0);
  const poseRate = Number(results.poseDetectionRate || 0);
  const ballRate = Number(results.ballDetectionRate || 0);
  const actionCount = Number(results.actionCount || 0);
  const topCue = results.dominantFeedback?.[0];

  if (poseRate < 70) {
    reasons.push({
      label: "Pose Visibility",
      text: `Pose tracking was ${poseRate.toFixed(1)}%, so the body-form score may be lower than the real movement.`,
      tone: "warning",
    });
  }

  if (ballRate < 45) {
    reasons.push({
      label: "Ball Visibility",
      text: `Ball tracking was ${ballRate.toFixed(1)}%, so action timing and shot review may miss some moments.`,
      tone: "warning",
    });
  }

  if (activeMode.id === "shooting_form") {
    const attempts = Number(results.shootingStats?.attempts || 0);
    const makes = Number(results.shootingStats?.makes || 0);
    const accuracy = Number(results.shootingStats?.accuracy || 0);
    if (attempts > 0) {
      reasons.push({
        label: "Shot Result",
        text: `${makes}/${attempts} shots were counted as makes (${accuracy.toFixed(1)}%). Makes affect the shooting result, while form cues affect the technique score.`,
        tone: accuracy >= 70 ? "good" : "warning",
      });
    } else {
      reasons.push({
        label: "Shot Result",
        text: "No clear shot sequence was counted yet. Keep the player, ball, and hoop visible through release and hoop entry.",
        tone: "warning",
      });
    }
  } else if (actionCount > 0) {
    reasons.push({
      label: activeMode.id === "dribbling" ? "Dribbles Counted" : "Passes Counted",
      text: `${actionCount} ${activeMode.id === "dribbling" ? "dribbles" : "passes"} were counted. Cleaner visibility and steadier rhythm usually improve the review.`,
      tone: "good",
    });
  } else {
    reasons.push({
      label: "Action Count",
      text: `No clear ${activeMode.id === "dribbling" ? "dribbles" : "passes"} were counted. Record with the ball, hands, and full body in frame.`,
      tone: "warning",
    });
  }

  reasons.push({
    label: "Main Form Cue",
    text: topCue || (score >= 75 ? "Strong form pattern. Repeat the same setup in the annotated video." : "No single cue dominated yet. Start with balance and visibility."),
    tone: score >= 75 ? "good" : "neutral",
  });

  return reasons.slice(0, 4);
}

function buildSetupGuide(activeMode) {
  return getModeGuide(activeMode.id);
}

function normalizeShotEvents(events) {
  if (!Array.isArray(events)) {
    return [];
  }
  return events
    .map((event, index) => {
      const source = event || {};
      const timestampSeconds = numericOrNull(source.timestampSeconds ?? source.timestamp_seconds);
      const resultTimestampSeconds = numericOrNull(source.resultTimestampSeconds ?? source.result_timestamp_seconds);
      const reviewStartSeconds = timestampSeconds ?? resultTimestampSeconds ?? 0;
      const evidence = Array.isArray(source.evidence) ? source.evidence.filter(Boolean) : [];
      return {
        shotNumber: Number(source.shotNumber ?? source.shot_number ?? index + 1) || index + 1,
        result: String(source.result || "pending").toLowerCase(),
        timestampSeconds: reviewStartSeconds,
        resultTimestampSeconds,
        reviewSeconds: Math.max(0, reviewStartSeconds - 1),
        reason: source.reason || source.review_reason || source.result_reason || "",
        resultQuality: String(source.resultQuality || source.result_quality || "").toLowerCase(),
        evidence,
      };
    })
    .sort((a, b) => a.shotNumber - b.shotNumber);
}

function normalizePhaseScores(scores) {
  if (!Array.isArray(scores)) {
    return [];
  }
  return scores
    .filter((phase) => String(phase?.key || "") !== "shot_pocket")
    .map((phase, index) => ({
      key: String(phase?.key || `phase-${index}`),
      label: String(phase?.label || `Phase ${index + 1}`),
      averageScore: Number(phase?.averageScore ?? phase?.average_score ?? 0) || 0,
      frameCount: Number(phase?.frameCount ?? phase?.frame_count ?? 0) || 0,
      status: String(phase?.status || "not_observed"),
      focus: String(phase?.focus || ""),
      cue: String(phase?.cue || ""),
    }));
}

function numericOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatShotTime(seconds) {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = String(safeSeconds % 60).padStart(2, "0");
  return `${minutes}:${remainder}`;
}

function formatShotResult(result) {
  if (result === "make") return "Make";
  if (result === "miss") return "Miss";
  return "Review";
}

function shotResultColor(result) {
  if (result === "make") return colors.success;
  if (result === "miss") return colors.warning;
  return colors.secondary;
}

function resultQualityColor(quality) {
  if (quality === "high") return colors.success;
  if (quality === "medium") return colors.warning;
  if (quality === "low") return colors.danger;
  return colors.secondary;
}

function formatResultQuality(quality) {
  if (quality === "high") return "High";
  if (quality === "medium") return "Medium";
  if (quality === "low") return "Low";
  return "Review";
}

function shotFeedbackText(result, reviewLevel = "beginner") {
  if (result === "make") {
    return reviewLevel === "intermediate"
      ? "Good result. Check setup, release, and landing so you can repeat the same pattern."
      : "Good result. Replay this shot and copy the same rhythm.";
  }
  if (result === "miss") {
    return reviewLevel === "intermediate"
      ? "Missed shot. Review base balance, release line, follow-through, and whether the ball path stayed centered."
      : "Missed shot. Check balance, release line, and ball path.";
  }
  return reviewLevel === "intermediate"
    ? "Result not clear. Check if the ball, hoop, and shooting motion are visible in this moment."
    : "Result not clear. Watch this moment and check if the ball and hoop are visible.";
}

function shotReasonText(event, reviewLevel = "beginner") {
  if (event.reason) {
    return event.reason;
  }
  if (event.result === "make") {
    return reviewLevel === "intermediate"
      ? "Counted as a make because the tracked ball path reached the hoop result window."
      : "Counted as a make when the ball was tracked through the hoop area.";
  }
  if (event.result === "miss") {
    return reviewLevel === "intermediate"
      ? "Counted as a miss because the attempt resolved without a confirmed ball-through-hoop path."
      : "Counted as a miss when the ball did not clearly pass through the hoop.";
  }
  return "Marked for review because the result was not clear enough.";
}

function buildTrackingReview(results) {
  const poseRate = Number(results.poseDetectionRate || 0);
  const ballRate = Number(results.ballDetectionRate || 0);
  const trackingRate = Math.min(poseRate, ballRate);
  if (trackingRate >= 70) {
    return {
      label: "Good",
      color: colors.success,
      text: "The camera view was clear enough for useful coaching.",
    };
  }
  if (trackingRate >= 45) {
    return {
      label: "Fair",
      color: colors.warning,
      text: "Useful review, but some moments may be affected by camera angle or blur.",
    };
  }
  return {
    label: "Low",
    color: colors.danger,
    text: "Treat the score carefully. Try a clearer full-body angle next time.",
  };
}

function buildCoachReview({ activeMode, results }) {
  const mainFocus = results.dominantFeedback?.[0] || "Keep reviewing the annotated video and repeat your best reps.";
  const tracking = buildTrackingReview(results);
  const score = Number(results.averageScore || 0);
  const scoreText =
    score >= 80
      ? "Strong clip. Use the video to repeat what worked."
      : score >= 60
        ? "Good starting point. Fix the main focus first, then retest."
        : "Use this as a practice guide. Focus on one simple cue before worrying about the score.";
  const nextDrill =
    activeMode.id === "shooting_form"
      ? "Next drill: take 10 close shots and focus only on the main cue."
      : activeMode.id === "dribbling"
        ? "Next drill: 30 seconds of controlled low dribbles while staying balanced."
        : "Next drill: 10 chest passes, finishing with your hands toward the target.";

  return {
    mainFocus,
    tracking,
    scoreText,
    nextDrill,
  };
}

function buildModeReview({ activeMode, results }) {
  const actionCount = Number(results.actionCount || 0);
  const focus = results.dominantFeedback?.[0] || "Keep the ball and body visible, then repeat the drill with control.";
  const score = Number(results.averageScore || 0);
  const tracking = buildTrackingReview(results);

  if (activeMode.id === "dribbling") {
    const sections = [
      buildReviewStatus("Ball Path", score, "Keep the bounce close to your dribbling side and below hip height."),
      buildReviewStatus("Stance", Math.min(score, Number(results.poseDetectionRate || 0)), "Stay low with bent knees and balanced hips."),
      buildReviewStatus("Rhythm", actionCount > 0 ? 78 : 45, "Aim for steady bounces instead of rushed or missed contacts."),
    ];
    return {
      title: "Dribbling Review",
      actionLabel: "Dribbles Counted",
      actionValue: actionCount,
      intro: "Use this to check ball path, stance, and rhythm while watching the annotated clip.",
      sections,
      moments: buildModeMomentCards(sections, "dribbling"),
      beginnerCue: focus,
      intermediateCue: "Check if the visible ball path stays below the hip and close to the body line.",
      nextDrill: "Next drill: 30 seconds of low controlled dribbles, then switch hands.",
      tracking,
    };
  }

  if (activeMode.id === "passing") {
    const sections = [
      buildReviewStatus("Release Line", score, "Finish with your hands pointed toward the target."),
      buildReviewStatus("Ball Path", Math.min(score, Number(results.ballDetectionRate || 0)), "Keep the ball visible and near the chest before it leaves your hands."),
      buildReviewStatus("Balance", Math.min(score, Number(results.poseDetectionRate || 0)), "Stay balanced instead of leaning out of the pass."),
    ];
    return {
      title: "Passing Review",
      actionLabel: "Passes Counted",
      actionValue: actionCount,
      intro: "Use this to check release line, visible ball path, and balance through the pass.",
      sections,
      moments: buildModeMomentCards(sections, "passing"),
      beginnerCue: focus,
      intermediateCue: "Review elbow extension, wrist line, visible ball path, and balance at release.",
      nextDrill: "Next drill: 10 chest passes, freeze your follow-through after every pass.",
      tracking,
    };
  }

  return null;
}

function buildReviewStatus(label, value, tip) {
  const numericValue = Number(value || 0);
  if (numericValue >= 75) {
    return { label, status: "Good", color: colors.success, tip, value: numericValue };
  }
  if (numericValue >= 55) {
    return { label, status: "Fair", color: colors.warning, tip, value: numericValue };
  }
  return { label, status: "Needs Work", color: colors.danger, tip, value: numericValue };
}

function buildModeMomentCards(sections, modeId) {
  const sorted = [...sections].sort((a, b) => Number(b.value || 0) - Number(a.value || 0));
  const best = sorted[0];
  const fix = sorted[sorted.length - 1];
  const timeBase = modeId === "dribbling" ? { best: 5, fix: 10 } : { best: 5, fix: 8 };

  return [
    {
      label: "Best Check",
      title: best?.label || "Strongest Cue",
      time: timeBase.best,
      color: best?.color || colors.success,
      text: best?.tip || "Replay this moment and copy the same body control.",
    },
    {
      label: "Fix First",
      title: fix?.label || "Main Fix",
      time: timeBase.fix,
      color: fix?.color || colors.warning,
      text: fix?.tip || "Replay this moment and correct the main cue first.",
    },
  ];
}

function buildReviewMoments({ activeMode, results, shotEvents }) {
  if (activeMode.id === "shooting_form") {
    return shotEvents;
  }

  const hasAnalysis = Number(results.analyzedFrames || 0) > 0;
  if (!hasAnalysis) {
    return [];
  }

  if (activeMode.id === "dribbling") {
    return [
      { label: "Start Stance", result: "review", timestampSeconds: 0, reviewSeconds: 0 },
      { label: "Control Check", result: "review", timestampSeconds: 5, reviewSeconds: 5 },
      { label: "Finish Rhythm", result: "review", timestampSeconds: 10, reviewSeconds: 10 },
    ];
  }

  if (activeMode.id === "passing") {
    return [
      { label: "Load", result: "review", timestampSeconds: 0, reviewSeconds: 0 },
      { label: "Release Line", result: "review", timestampSeconds: 5, reviewSeconds: 5 },
      { label: "Balance Finish", result: "review", timestampSeconds: 10, reviewSeconds: 10 },
    ];
  }

  return [];
}

export default function UnifiedCoachingSessionScreen({ route, navigation }) {
  const initialModeId = route.params?.initialModeId || "shooting_form";
  const { playerEmail, playerName, userId } = useAuth();
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const landscapeViewport = viewportWidth > viewportHeight;
  const collapsedCameraHeight = landscapeViewport
    ? Math.max(300, viewportHeight)
    : Math.min(
        Math.max(430, Math.round(viewportHeight - COLLAPSED_SHEET_HEIGHT_ESTIMATE + SHEET_TOP_OVERLAP)),
        Math.max(360, viewportHeight - 86)
      );
  const expandedCameraHeight = landscapeViewport
    ? Math.max(240, Math.round(viewportHeight * 0.58))
    : Math.min(
        Math.max(280, Math.round(viewportHeight * 0.43)),
        Math.max(280, collapsedCameraHeight - 220)
      );
  const [selectedModeId, setSelectedModeId] = useState(initialModeId);
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [videoSource, setVideoSource] = useState("camera");
  const [testMode, setTestMode] = useState(false);
  const [jobId, setJobId] = useState(null);
  const [status, setStatus] = useState("idle");
  const [progress, setProgress] = useState(0);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [coachingResults, setCoachingResults] = useState(INITIAL_COACHING_RESULTS);
  const [errorMessage, setErrorMessage] = useState("");
  const [archiveMessage, setArchiveMessage] = useState("");
  const [archiveMessageTone, setArchiveMessageTone] = useState("neutral");
  const [backendStatus, setBackendStatus] = useState({ label: "Checking backend", ready: null });
  const [starting, setStarting] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraViewKey, setCameraViewKey] = useState(0);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [cameraTrouble, setCameraTrouble] = useState(false);
  const [recording, setRecording] = useState(false);
  const [cameraFacing, setCameraFacing] = useState("back");
  const [countdownValue, setCountdownValue] = useState(null);
  const [recordingCountdownSeconds, setRecordingCountdownSeconds] = useState(3);
  const [recordingCountdownSound, setRecordingCountdownSound] = useState(true);
  const [sourceOrientation, setSourceOrientation] = useState("auto");
  const [menuOpen, setMenuOpen] = useState(false);
  const [overlayMode, setOverlayMode] = useState("focus_feedback");
  const [reviewLevel, setReviewLevel] = useState("beginner");
  const [recordingStatus, setRecordingStatus] = useState("Frame the player, then record or upload a clip.");
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const cameraRef = useRef(null);
  const countdownCancelRef = useRef(false);
  const uploadAbortRef = useRef(null);
  const cameraReadyTimerRef = useRef(null);
  const sheetContentScrollRef = useRef(null);
  const sheetDragStartHeightRef = useRef(collapsedCameraHeight);
  const cameraStageHeightRef = useRef(collapsedCameraHeight);
  const appGuideRootRef = useRef(null);
  const appGuideAutoCheckedUserRef = useRef(null);
  const appGuideTargetRefs = useRef({});
  const appGuideContentLayoutsRef = useRef({});
  const [cameraStageHeight, setCameraStageHeight] = useState(collapsedCameraHeight);
  const [appGuideVisible, setAppGuideVisible] = useState(false);
  const [appGuideStepIndex, setAppGuideStepIndex] = useState(0);
  const [appGuideTargetLayout, setAppGuideTargetLayout] = useState(null);
  const countdownPlayer = useAudioPlayer(COUNTDOWN_BEEP_SOURCE);
  const countdownStartPlayer = useAudioPlayer(COUNTDOWN_START_BUZZER_SOURCE);

  const userKey = useMemo(
    () => buildUserKey({ userId, playerName, playerEmail }),
    [playerEmail, playerName, userId]
  );

  const setAppGuideTargetRef = useCallback(
    (targetKey) => (node) => {
      if (node) {
        appGuideTargetRefs.current[targetKey] = node;
      }
    },
    []
  );

  const setAppGuideContentLayout = useCallback(
    (targetKey) => (event) => {
      appGuideContentLayoutsRef.current[targetKey] = event.nativeEvent.layout;
    },
    []
  );

  const refreshCountdownPreferences = useCallback(async () => {
    const [seconds, soundEnabled] = await Promise.all([
      getRecordingCountdownSecondsPreference(userKey),
      getRecordingCountdownSoundPreference(userKey),
    ]);
    setRecordingCountdownSeconds(seconds);
    setRecordingCountdownSound(soundEnabled);
  }, [userKey]);
  const activeMode = useMemo(
    () => MODES.find((item) => item.id === selectedModeId) || MODES[0],
    [selectedModeId]
  );
  const selectedOverlay = useMemo(
    () => COACHING_OVERLAY_OPTIONS.find((item) => item.id === overlayMode) || COACHING_OVERLAY_OPTIONS[1],
    [overlayMode]
  );
  const scoreExplanation = useMemo(
    () => buildScoreExplanation({ activeMode, results: coachingResults }),
    [activeMode, coachingResults]
  );
  const scoreReasons = useMemo(
    () => buildScoreReasons({ activeMode, results: coachingResults }),
    [activeMode, coachingResults]
  );
  const setupGuide = useMemo(
    () => buildSetupGuide(activeMode),
    [activeMode]
  );
  const coachReview = useMemo(
    () => buildCoachReview({ activeMode, results: coachingResults }),
    [activeMode, coachingResults]
  );
  const reviewShotEvents = useMemo(
    () => normalizeShotEvents(coachingResults.shotEvents),
    [coachingResults.shotEvents]
  );
  const modeReview = useMemo(
    () => buildModeReview({ activeMode, results: coachingResults }),
    [activeMode, coachingResults]
  );
  const reviewMoments = useMemo(
    () => buildReviewMoments({ activeMode, results: coachingResults, shotEvents: reviewShotEvents }),
    [activeMode, coachingResults, reviewShotEvents]
  );

  const resultVideoUrl = useMemo(() => {
    if (!jobId || status !== "completed") {
      return null;
    }
    return buildCoachingVideoDownloadUrl(jobId);
  }, [jobId, status]);
  const coachingSpeechText = useMemo(
    () =>
      buildCoachingSpeech({
        modeLabel: `${activeMode.title} coaching`,
        score: coachingResults.averageScore,
        classification: coachingResults.classification,
        feedback: coachingResults.dominantFeedback,
        summary: coachingResults.summary,
        stats: activeMode.id === "shooting_form" ? coachingResults.shootingStats : null,
      }),
    [activeMode, coachingResults]
  );

  const selectedVideoLabel = useMemo(() => {
    if (!selectedVideo) {
      return "No clip selected yet.";
    }
    return selectedVideo.name || (videoSource === "camera" ? "Recorded coaching clip" : "Uploaded coaching clip");
  }, [selectedVideo, videoSource]);
  const cameraPowered = cameraOpen && cameraPermission?.granted;
  const cameraFallbackIcon = videoSource === "upload" ? "upload-cloud" : cameraPermission?.granted ? "camera-off" : "camera";
  const cameraFallbackTitle =
    videoSource === "upload" ? "Upload ready" : cameraPermission?.granted && !cameraOpen ? "Camera off" : "Camera ready";
  const cameraFallbackText =
    videoSource === "upload"
      ? selectedVideoLabel
      : cameraPermission?.granted && !cameraOpen
        ? "Camera is off to reduce heat. Turn it on when you are ready to record."
        : "Allow camera access to record your shooting, dribbling, or passing clip.";
  const cameraToggleLabel = cameraPowered ? "Turn camera off" : "Turn camera on";

  const modeSwipeResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gestureState) =>
          Math.abs(gestureState.dx) > 28 &&
          Math.abs(gestureState.dx) > Math.abs(gestureState.dy) &&
          status !== "processing" &&
          !starting &&
          !recording,
        onPanResponderRelease: (_event, gestureState) => {
          if (gestureState.dx < -48) {
            cycleMode(1);
          } else if (gestureState.dx > 48) {
            cycleMode(-1);
          }
        },
      }),
    [recording, selectedModeId, starting, status]
  );

  const sheetDragResponder = useMemo(
    () => {
      const shouldStartSheetDrag = (_event, gestureState) => {
        const verticalDrag = Math.abs(gestureState.dy) > 8 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx);
        if (!verticalDrag) {
          return false;
        }
        const draggingUp = gestureState.dy < 0;
        const draggingDown = gestureState.dy > 0;
        const canExpand = cameraStageHeightRef.current > expandedCameraHeight + 2;
        const canCollapse = cameraStageHeightRef.current < collapsedCameraHeight - 2;

        return (draggingUp && canExpand) || (draggingDown && canCollapse);
      };

      return PanResponder.create({
        onMoveShouldSetPanResponder: shouldStartSheetDrag,
        onMoveShouldSetPanResponderCapture: shouldStartSheetDrag,
        onPanResponderGrant: () => {
          sheetDragStartHeightRef.current = cameraStageHeightRef.current;
        },
        onPanResponderMove: (_event, gestureState) => {
          const nextHeight = clampValue(
            sheetDragStartHeightRef.current + gestureState.dy,
            expandedCameraHeight,
            collapsedCameraHeight
          );
          cameraStageHeightRef.current = nextHeight;
          setCameraStageHeight(nextHeight);
        },
        onPanResponderRelease: (_event, gestureState) => {
          const projectedHeight = sheetDragStartHeightRef.current + gestureState.dy + gestureState.vy * 70;
          const midpoint = (expandedCameraHeight + collapsedCameraHeight) / 2;
          const nextHeight =
            gestureState.vy < -0.55 || projectedHeight < midpoint ? expandedCameraHeight : collapsedCameraHeight;
          cameraStageHeightRef.current = nextHeight;
          setCameraStageHeight(nextHeight);
          if (nextHeight === collapsedCameraHeight) {
            resetSheetContentScroll();
          }
          hapticSelection();
        },
        onPanResponderTerminationRequest: () => false,
      });
    },
    [collapsedCameraHeight, expandedCameraHeight]
  );

  useEffect(() => {
    const nextHeight = clampValue(cameraStageHeightRef.current, expandedCameraHeight, collapsedCameraHeight);
    cameraStageHeightRef.current = nextHeight;
    setCameraStageHeight(nextHeight);
  }, [collapsedCameraHeight, expandedCameraHeight]);

  useEffect(() => {
    let mounted = true;
    refreshCountdownPreferences()
      .then(() => {
        if (!mounted) {
          return;
        }
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [refreshCountdownPreferences]);

  useFocusEffect(
    useCallback(() => {
      refreshCountdownPreferences().catch(() => {});
    }, [refreshCountdownPreferences])
  );

  useEffect(() => {
    if (cameraOpen) {
      ScreenOrientation.unlockAsync().catch(() => {});
      return () => {
        ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
      };
    }

    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    return undefined;
  }, [cameraOpen]);

  useEffect(() => {
    const nextModeId = route.params?.initialModeId || "shooting_form";
    const nextMode = MODES.find((item) => item.id === nextModeId) || MODES[0];
    setSelectedModeId(nextMode.id);
    clearCameraReadyTimer();
    setCameraOpen(false);
    setCameraStarting(false);
    setCameraTrouble(false);
    setRecording(false);
    setCountdownValue(null);
    countdownCancelRef.current = true;
    setMenuOpen(false);
    setSourceOrientation("auto");
    setRecordingStatus("Camera off. Turn it on when you are ready to record or upload a clip.");
    resetRunState();
  }, [route.params?.initialModeId]);

  useEffect(() => {
    if (!jobId || status !== "processing") {
      return undefined;
    }

    const timer = setInterval(async () => {
      try {
        const result = await fetchCoachingVideoStatus(jobId);
        setProgress(clampPercent(result.progress_percentage));
        setCoachingResults({
          analyzedFrames: result.analyzed_frames || 0,
          poseFrames: result.pose_frames || 0,
          ballFrames: result.ball_frames || 0,
          poseDetectionRate: result.pose_detection_rate || 0,
          ballDetectionRate: result.ball_detection_rate || 0,
          averageScore: result.average_score || 0,
          bestScore: result.best_score || 0,
          worstScore: result.worst_score || 0,
          actionCount: result.action_count || 0,
          actionLabel: result.action_label || "",
          shootingStats: result.shooting_stats || INITIAL_COACHING_RESULTS.shootingStats,
          shotEvents: result.shot_events || [],
          classification: result.classification || "",
          summary: result.summary || "",
          dominantFeedback: result.dominant_feedback || [],
          poseComparison: result.pose_comparison || [],
          phaseScores: normalizePhaseScores(result.phase_scores),
          inputWidth: result.input_width || 0,
          inputHeight: result.input_height || 0,
          outputWidth: result.output_width || 0,
          outputHeight: result.output_height || 0,
          inputOrientation: result.input_orientation || "unknown",
          outputOrientation: result.output_orientation || "unknown",
        });

        if (result.status === "completed") {
          const archivedAt = new Date().toISOString();
          const remoteVideoUrl = buildCoachingVideoDownloadUrl(result.file_id);
          const archiveResult = await archiveCompletedSession({
            userKey,
            remoteVideoUrl,
            videoSaveOptions: {
              sessionId: result.file_id,
              mode: activeMode.id,
              timestamp: archivedAt,
              suffix: "coaching",
            },
            record: {
              id: result.file_id,
              userKey,
              playerName,
              playerEmail,
              mode: activeMode.id,
              modeLabel: activeMode.title,
              score: result.average_score || 0,
              actionCount: result.action_count || 0,
              actionLabel: result.action_label || "",
              shootingStats: result.shooting_stats || INITIAL_COACHING_RESULTS.shootingStats,
              shotEvents: result.shot_events || [],
              phaseScores: normalizePhaseScores(result.phase_scores),
              classification: result.classification || "Needs Improvement",
              detectedErrors: (result.dominant_feedback || []).map((message) => ({
                issue: message,
                severity: "Moderate",
              })),
              timestamp: archivedAt,
              summary: result.summary || "",
            },
            messages: {
              success: "Annotated video saved on this phone for Session History.",
              disabled: "Analysis finished. Automatic video saving is turned off in Settings.",
              failurePrefix: "Analysis finished, but offline save failed",
            },
          });
          setArchiveMessageTone(archiveResult.archiveMessageTone);
          setArchiveMessage(archiveResult.archiveMessage);
          setStatus("completed");
          hapticSuccess();
        } else if (result.status === "cancelled") {
          setStatus("cancelled");
          setErrorMessage("Analysis cancelled.");
          hapticWarning();
        } else if (result.status === "error") {
          setStatus("error");
          setErrorMessage(result.error_message || "Coaching video analysis failed.");
          hapticWarning();
        }
      } catch (error) {
        setStatus("error");
        setErrorMessage(String(error.message || error));
        hapticWarning();
      }
    }, 1500);

    return () => clearInterval(timer);
  }, [activeMode.id, activeMode.title, jobId, playerEmail, playerName, status, userKey]);

  useEffect(() => {
    let mounted = true;

    async function refreshBackendStatus() {
      try {
        const result = await healthCheck();
        if (!mounted) {
          return;
        }
        const ready = Boolean(result.ball_detector_ready);
        setBackendStatus({
          ready,
          label: ready ? "Backend ready" : "Ball detector not ready",
        });
      } catch (_error) {
        if (mounted) {
          setBackendStatus({ ready: false, label: "Backend offline" });
        }
      }
    }

    refreshBackendStatus();
    const timer = setInterval(refreshBackendStatus, 15000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    return () => {
      countdownCancelRef.current = true;
      clearCameraReadyTimer();
      if (cameraRef.current && recording) {
        cameraRef.current.stopRecording();
      }
    };
  }, [recording]);

  function clearCameraReadyTimer() {
    if (cameraReadyTimerRef.current) {
      clearTimeout(cameraReadyTimerRef.current);
      cameraReadyTimerRef.current = null;
    }
  }

  function beginCameraWarmup() {
    clearCameraReadyTimer();
    setCameraStarting(true);
    setCameraTrouble(false);
    cameraReadyTimerRef.current = setTimeout(() => {
      setCameraStarting(false);
      setCameraTrouble(true);
      setRecordingStatus("Camera preview did not start. Restart the camera if the preview is black.");
    }, 4500);
  }

  function handleCameraReady() {
    clearCameraReadyTimer();
    setCameraStarting(false);
    setCameraTrouble(false);
    setRecordingStatus("Frame the player, then tap record.");
  }

  function playCountdownCue() {
    hapticSelection();
    if (!recordingCountdownSound) {
      return;
    }
    try {
      countdownPlayer.seekTo(0);
      countdownPlayer.play();
    } catch (_error) {
      // Haptics still provide a fallback cue if audio is unavailable.
    }
  }

  function playCountdownStartCue() {
    hapticImpact(Haptics.ImpactFeedbackStyle.Heavy);
    if (!recordingCountdownSound) {
      return;
    }
    try {
      countdownStartPlayer.seekTo(0);
      countdownStartPlayer.play();
    } catch (_error) {
      // Haptics still provide a fallback start cue if audio is unavailable.
    }
  }

  function cancelRecordingCountdown() {
    countdownCancelRef.current = true;
    setCountdownValue(null);
    setRecordingStatus("Countdown cancelled. Tap record when you are ready.");
    hapticWarning();
  }

  async function pickVideo() {
    hapticSelection();
    const result = await DocumentPicker.getDocumentAsync({
      type: "video/*",
      copyToCacheDirectory: true,
    });
    if (result.canceled) {
      return;
    }

    setVideoSource("upload");
    setSelectedVideo(result.assets[0]);
    setSourceOrientation("auto");
    clearCameraReadyTimer();
    setCameraOpen(false);
    setCameraStarting(false);
    setCameraTrouble(false);
    setMenuOpen(false);
    setRecordingStatus("Uploaded clip ready for coaching analysis.");
    resetRunState();
  }

  async function openCameraRecorder() {
    hapticSelection();
    if (!cameraPermission?.granted) {
      const permissionResult = await requestCameraPermission();
      if (!permissionResult.granted) {
        setErrorMessage("Camera permission is required to record a coaching clip.");
        return;
      }
    }

    setVideoSource("camera");
    setCameraOpen(true);
    setCameraViewKey((current) => current + 1);
    beginCameraWarmup();
    setMenuOpen(false);
    setRecordingStatus("Starting camera...");
    setErrorMessage("");
  }

  async function startRecordingClip() {
    if (!cameraRef.current || recording || countdownValue !== null) {
      return;
    }

    setErrorMessage("");
    hapticImpact(Haptics.ImpactFeedbackStyle.Medium);
    const countdownSeconds = Number(recordingCountdownSeconds || 0);
    if (countdownSeconds > 0) {
      countdownCancelRef.current = false;
      setRecordingStatus(`Get ready. Recording starts in ${countdownSeconds} seconds.`);
      for (let remaining = countdownSeconds; remaining > 0; remaining -= 1) {
        if (countdownCancelRef.current) {
          return;
        }
        setCountdownValue(remaining);
        playCountdownCue();
        await wait(1000);
      }
      if (countdownCancelRef.current) {
        return;
      }
      setCountdownValue(null);
    }

    await beginRecordingClip({ playStartCue: countdownSeconds > 0 });
  }

  async function beginRecordingClip({ playStartCue = false } = {}) {
    if (!cameraRef.current || recording) {
      return;
    }

    setRecording(true);
    if (playStartCue) {
      playCountdownStartCue();
    }
    const recordingSourceOrientation = landscapeViewport ? "landscape" : "portrait";
    setRecordingStatus("Recording in progress...");

    try {
      const result = await cameraRef.current.recordAsync({
        maxDuration: testMode ? 15 : 30,
      });

      if (result?.uri) {
        setSelectedVideo({
          uri: result.uri,
          name: `${activeMode.id}-${Date.now()}.mp4`,
          mimeType: "video/mp4",
        });
        setVideoSource("camera");
        setSourceOrientation(recordingSourceOrientation);
        setCameraOpen(true);
        setRecordingStatus("Recorded clip ready for coaching analysis.");
        resetRunState();
      } else {
        setRecordingStatus("Recording ended before a clip was saved.");
      }
    } catch (error) {
      setErrorMessage(String(error.message || error));
      setRecordingStatus("Recording failed. Try again.");
    } finally {
      setRecording(false);
    }
  }

  function stopRecordingClip() {
    if (!cameraRef.current || !recording) {
      return;
    }
    hapticImpact(Haptics.ImpactFeedbackStyle.Heavy);
    cameraRef.current.stopRecording();
    setRecordingStatus("Finishing clip...");
  }

  function toggleCameraFacing() {
    if (recording || countdownValue !== null || busyWithAnalysis) {
      return;
    }
    hapticSelection();
    setCameraFacing((current) => {
      const nextFacing = current === "back" ? "front" : "back";
      setRecordingStatus(`${nextFacing === "front" ? "Front" : "Back"} camera ready.`);
      return nextFacing;
    });
  }

  async function toggleCameraPower() {
    if (recording || countdownValue !== null) {
      return;
    }

    hapticSelection();
    if (cameraOpen) {
      clearCameraReadyTimer();
      setCameraOpen(false);
      setCameraStarting(false);
      setCameraTrouble(false);
      setRecordingStatus("Camera off. Turn it on when you are ready to record.");
      return;
    }

    await openCameraRecorder();
  }

  function restartCameraPreview() {
    hapticSelection();
    setCameraOpen(true);
    setCameraViewKey((current) => current + 1);
    beginCameraWarmup();
    setRecordingStatus("Restarting camera...");
  }

  function handleModeChange(nextModeId) {
    const nextMode = MODES.find((item) => item.id === nextModeId) || MODES[0];
    if (nextMode.id !== selectedModeId) {
      hapticSelection();
    }
    setSelectedModeId(nextMode.id);
    setRecording(false);
    setMenuOpen(false);
    setRecordingStatus(
      cameraOpen ? "Frame the player, then record or upload a clip." : "Camera off. Turn it on when you are ready to record."
    );
    resetRunState();
  }

  function cycleMode(direction) {
    const currentIndex = MODES.findIndex((mode) => mode.id === selectedModeId);
    const safeIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = (safeIndex + direction + MODES.length) % MODES.length;
    handleModeChange(MODES[nextIndex].id);
  }

  function resetSheetContentScroll() {
    sheetContentScrollRef.current?.scrollTo({ y: 0, animated: false });
  }

  function setBottomModeTrayOpen(open) {
    const nextHeight = open ? expandedCameraHeight : collapsedCameraHeight;
    cameraStageHeightRef.current = nextHeight;
    setCameraStageHeight(nextHeight);
    if (!open) {
      resetSheetContentScroll();
    }
    hapticSelection();
  }

  async function handleStartSession() {
    if (!selectedVideo) {
      return;
    }
    if (backendUnavailable) {
      setStatus("error");
      setErrorMessage("Backend is not ready. Check that the server and YOLOv11 ball detector are running.");
      hapticWarning();
      return;
    }

    setStarting(true);
    setStatus("starting");
    setErrorMessage("");
    setArchiveMessage("");
    setArchiveMessageTone("neutral");
    setProgress(0);
    setUploadProgress(0);
    setCoachingResults(INITIAL_COACHING_RESULTS);

    try {
      hapticImpact(Haptics.ImpactFeedbackStyle.Medium);
      const abortController = new AbortController();
      uploadAbortRef.current = abortController;
      setStatus("uploading");
      const result = await startCoachingVideoAnalysis({
        mode: activeMode.id,
        videoAsset: selectedVideo,
        overlayMode,
        testMode,
        userKey,
        sourceOrientation,
        abortSignal: abortController.signal,
        onUploadProgress: (value) => setUploadProgress(clampPercent(value)),
      });
      setJobId(result.file_id);
      setStatus("processing");
      setProgress(0);
    } catch (error) {
      if (error.name === "AbortError") {
        setStatus("cancelled");
        setErrorMessage("Upload cancelled. The selected clip is still ready to retry.");
      } else {
        setStatus("error");
        setErrorMessage(String(error.message || error));
      }
      hapticWarning();
    } finally {
      uploadAbortRef.current = null;
      setStarting(false);
    }
  }

  async function handleCancelSession() {
    if (uploadAbortRef.current) {
      uploadAbortRef.current.abort();
      return;
    }
    if (status === "processing" && jobId) {
      try {
        await cancelCoachingVideoAnalysis(jobId);
        setStatus("cancelled");
        setErrorMessage("Analysis cancelled.");
      } catch (error) {
        setStatus("error");
        setErrorMessage(String(error.message || error));
      }
      hapticWarning();
    }
  }

  async function openResultVideo() {
    if (!resultVideoUrl) {
      return;
    }
    await Linking.openURL(resultVideoUrl);
  }

  function resetRunState() {
    setJobId(null);
    setStatus("idle");
    setProgress(0);
    setUploadProgress(0);
    setCoachingResults(INITIAL_COACHING_RESULTS);
    setErrorMessage("");
    setArchiveMessage("");
    setArchiveMessageTone("neutral");
  }

  const busyWithAnalysis = status === "processing" || status === "uploading" || starting;
  const backendUnavailable = backendStatus.ready === false;
  const displayedProgress = clampPercent(progress);
  const displayedUploadProgress = clampPercent(uploadProgress);
  const countdownActive = countdownValue !== null;
  const sideCaptureControlsDisabled = busyWithAnalysis || recording || countdownActive;
  const cameraFacingLabel = cameraFacing === "front" ? "Front" : "Back";
  const sourceOrientationLabel =
    sourceOrientation === "landscape" ? "Landscape" : sourceOrientation === "portrait" ? "Portrait" : "Auto";
  const recordButtonDisabled =
    busyWithAnalysis ||
    (cameraOpen && !cameraPermission?.granted) ||
    cameraStarting ||
    cameraTrouble ||
    recordingStatus === "Finishing clip...";
  const recordButtonAction = countdownActive ? cancelRecordingCountdown : recording ? stopRecordingClip : cameraOpen ? startRecordingClip : openCameraRecorder;
  const bottomModeTrayOpen = cameraStageHeight < collapsedCameraHeight - 40;
  const trainingMenuBottomOffset = bottomModeTrayOpen ? 104 : 118;
  const trainingMenuMaxHeight = Math.max(88, cameraStageHeight - trainingMenuBottomOffset - 96);
  const appGuideStep = APP_GUIDE_STEPS[appGuideStepIndex] || APP_GUIDE_STEPS[0];
  const appGuideCanShow = !recording && !countdownActive && !busyWithAnalysis;

  const measureAppGuideTarget = useCallback(() => {
    const targetNode = appGuideTargetRefs.current[appGuideStep?.target];
    const rootNode = appGuideRootRef.current;
    if (!targetNode?.measureInWindow || !rootNode?.measureInWindow) {
      setAppGuideTargetLayout({ x: 16, y: Math.max(80, viewportHeight - 260), width: viewportWidth - 32, height: 120 });
      return;
    }

    rootNode.measureInWindow((rootX, rootY) => {
      targetNode.measureInWindow((windowX, windowY, width, height) => {
        if (!width || !height) {
          setAppGuideTargetLayout({ x: 16, y: Math.max(80, viewportHeight - 260), width: viewportWidth - 32, height: 120 });
          return;
        }

        const localX = windowX - rootX;
        const localY = windowY - rootY;
        const safeX = clampValue(localX, 8, Math.max(8, viewportWidth - 80));
        const safeY = clampValue(localY, 8, Math.max(8, viewportHeight - 80));
        const safeWidth = Math.max(44, Math.min(width, viewportWidth - safeX - 8));
        const safeHeight = Math.max(36, Math.min(height, viewportHeight - safeY - 8));
        setAppGuideTargetLayout({ x: safeX, y: safeY, width: safeWidth, height: safeHeight });
      });
    });
  }, [appGuideStep?.target, viewportHeight, viewportWidth]);

  const completeAppGuide = useCallback(
    async (markSeen = true) => {
      setAppGuideVisible(false);
      setMenuOpen(false);
      setAppGuideTargetLayout(null);
      if (markSeen) {
        await setAppGuideSeenPreference(userKey, true);
      }
    },
    [userKey]
  );

  const startAppGuide = useCallback(() => {
    if (!appGuideCanShow) {
      return;
    }
    setMenuOpen(false);
    setAppGuideStepIndex(0);
    setAppGuideVisible(true);
    setAppGuideTargetLayout(null);
  }, [appGuideCanShow]);

  useEffect(() => {
    if (!appGuideVisible) {
      return undefined;
    }

    const requiresSheet = Boolean(appGuideStep?.requiresSheet);
    if (requiresSheet && !bottomModeTrayOpen) {
      setBottomModeTrayOpen(true);
    } else if (!requiresSheet && bottomModeTrayOpen) {
      setBottomModeTrayOpen(false);
    }
    if (menuOpen) {
      setMenuOpen(false);
    }
    if (requiresSheet) {
      const scrollTargetLayout = appGuideStep?.scrollTarget
        ? appGuideContentLayoutsRef.current[appGuideStep.scrollTarget]
        : null;
      sheetContentScrollRef.current?.scrollTo({
        y: Math.max(0, (scrollTargetLayout?.y || 0) - 18),
        animated: true,
      });
    }

    const timer = setTimeout(measureAppGuideTarget, appGuideStep?.scrollTarget ? 720 : requiresSheet ? 480 : 220);
    return () => clearTimeout(timer);
  }, [appGuideStep, appGuideStepIndex, appGuideVisible, bottomModeTrayOpen, measureAppGuideTarget, menuOpen]);

  useEffect(() => {
    if (!userKey || appGuideAutoCheckedUserRef.current === userKey || !appGuideCanShow) {
      return undefined;
    }

    let alive = true;
    appGuideAutoCheckedUserRef.current = userKey;
    getAppGuideSeenPreference(userKey)
      .then((seen) => {
        if (alive && !seen) {
          startAppGuide();
        }
      })
      .catch(() => {});

    return () => {
      alive = false;
    };
  }, [appGuideCanShow, startAppGuide, userKey]);

  return (
    <View ref={appGuideRootRef} collapsable={false} style={cameraStyles.screen}>
      <View style={[cameraStyles.cameraStage, { height: cameraStageHeight }]} {...modeSwipeResponder.panHandlers}>
        {cameraPowered ? (
          <>
            <CameraView
              key={`camera-${cameraViewKey}`}
              ref={cameraRef}
              active={cameraPowered}
              onCameraReady={handleCameraReady}
              style={StyleSheet.absoluteFill}
              mode="video"
              mute
              facing={cameraFacing}
              videoQuality="720p"
            />
            {cameraStarting || cameraTrouble ? (
              <View style={cameraStyles.cameraWarmupOverlay}>
                <Feather name={cameraTrouble ? "refresh-cw" : "camera"} size={30} color={colors.primary} />
                <Text style={cameraStyles.fallbackTitle}>{cameraTrouble ? "Camera needs restart" : "Starting camera"}</Text>
                <Text style={cameraStyles.fallbackText}>
                  {cameraTrouble ? "Restart the preview if it stays black." : "Preparing the camera preview."}
                </Text>
                {cameraTrouble ? (
                  <TouchableOpacity activeOpacity={0.9} onPress={restartCameraPreview} style={cameraStyles.permissionButton}>
                    <Text style={cameraStyles.permissionButtonText}>Restart Camera</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : null}
          </>
        ) : (
          <View style={[cameraStyles.cameraFallback, !bottomModeTrayOpen && cameraStyles.cameraFallbackCardDown]}>
            <Feather name={cameraFallbackIcon} size={42} color={colors.primary} />
            <Text style={cameraStyles.fallbackTitle}>{cameraFallbackTitle}</Text>
            <Text style={cameraStyles.fallbackText}>{cameraFallbackText}</Text>
            {videoSource === "upload" || cameraPermission?.granted ? (
              <TouchableOpacity activeOpacity={0.9} onPress={openCameraRecorder} style={cameraStyles.permissionButton}>
                <Text style={cameraStyles.permissionButtonText}>Open Camera</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity activeOpacity={0.9} onPress={requestCameraPermission} style={cameraStyles.permissionButton}>
                <Text style={cameraStyles.permissionButtonText}>Allow Camera</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        <View style={cameraStyles.topBar}>
          <TouchableOpacity
            ref={setAppGuideTargetRef("menuButton")}
            collapsable={false}
            activeOpacity={0.9}
            onPress={() => setMenuOpen((current) => !current)}
            style={cameraStyles.iconButton}
          >
            <Feather name={menuOpen ? "x" : "menu"} size={23} color={colors.text} />
          </TouchableOpacity>
          <View style={cameraStyles.brandPill}>
            <BrandMark size={24} />
            <Text style={cameraStyles.brandText}>SureBall</Text>
          </View>
          <TouchableOpacity activeOpacity={0.9} onPress={() => navigation.navigate("PlayerMenu")} style={cameraStyles.iconButton}>
            <Feather name="user" size={21} color={colors.text} />
          </TouchableOpacity>
        </View>

        <View ref={setAppGuideTargetRef("modeBadge")} collapsable={false} style={cameraStyles.modeBadge}>
          <Text style={cameraStyles.modeBadgeText}>{activeMode.title}</Text>
          <Text style={cameraStyles.modeBadgeMeta}>{selectedOverlay?.title}</Text>
        </View>

        {recording ? (
          <View style={cameraStyles.recordingPill}>
            <Text style={cameraStyles.recordingText}>REC</Text>
          </View>
        ) : null}

        {countdownActive ? (
          <View style={cameraStyles.countdownOverlay} pointerEvents="none">
            <Text style={cameraStyles.countdownNumber}>{countdownValue}</Text>
            <Text style={cameraStyles.countdownLabel}>Get ready</Text>
          </View>
        ) : null}

        {menuOpen ? (
          <View style={[cameraStyles.modeMenu, { bottom: trainingMenuBottomOffset, maxHeight: trainingMenuMaxHeight }]}>
            <View style={cameraStyles.menuHeader}>
              <View style={{ flex: 1 }}>
                <Text style={cameraStyles.menuEyebrow}>Training Menu</Text>
                <Text style={cameraStyles.menuTitle}>Quick controls</Text>
              </View>
              <TouchableOpacity
                activeOpacity={0.85}
                accessibilityLabel="Close coaching mode menu"
                onPress={() => {
                  hapticSelection();
                  setMenuOpen(false);
                }}
                style={cameraStyles.menuCloseButton}
              >
                <Feather name="x" size={20} color={colors.text} />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={cameraStyles.menuBody}
              contentContainerStyle={cameraStyles.menuBodyContent}
              showsVerticalScrollIndicator={bottomModeTrayOpen}
              bounces={bottomModeTrayOpen}
            >
              <View style={cameraStyles.testRow}>
                <View style={{ flex: 1 }}>
                  <Text style={cameraStyles.testTitle}>Quick test</Text>
                  <Text style={cameraStyles.testCopy}>Analyze about 15 seconds.</Text>
                </View>
                <Switch
                  value={testMode}
                  onValueChange={setTestMode}
                  thumbColor={colors.text}
                  trackColor={{ false: colors.track, true: colors.primary }}
                  disabled={busyWithAnalysis || recording}
                />
              </View>

              <Text style={[cameraStyles.menuEyebrow, { marginTop: 16 }]}>Tools</Text>
              <View style={cameraStyles.menuToolRow}>
                <TouchableOpacity
                  activeOpacity={0.9}
                  onPress={() => {
                    hapticSelection();
                    setMenuOpen(false);
                    startAppGuide();
                  }}
                  disabled={!appGuideCanShow}
                  style={[cameraStyles.menuToolButton, !appGuideCanShow && cameraStyles.disabledControl]}
                >
                  <Feather name="help-circle" size={16} color={colors.text} />
                  <Text style={cameraStyles.menuToolText}>Guide</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  activeOpacity={0.9}
                  onPress={() => {
                    hapticSelection();
                    setMenuOpen(false);
                    navigation.navigate("Settings");
                  }}
                  style={cameraStyles.menuToolButton}
                >
                  <Feather name="settings" size={16} color={colors.text} />
                  <Text style={cameraStyles.menuToolText}>Settings</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  activeOpacity={0.9}
                  accessibilityLabel={cameraToggleLabel}
                  onPress={() => {
                    setMenuOpen(false);
                    toggleCameraPower();
                  }}
                  disabled={recording}
                  style={[cameraStyles.menuToolButton, recording && cameraStyles.disabledControl]}
                >
                  <Feather name={cameraPowered ? "camera-off" : "camera"} size={16} color={colors.text} />
                  <Text style={cameraStyles.menuToolText}>{cameraPowered ? "Camera Off" : "Camera On"}</Text>
                </TouchableOpacity>
              </View>

              <Text style={[cameraStyles.menuEyebrow, { marginTop: 16 }]}>Full Guides</Text>
              <View style={cameraStyles.menuGuideRow}>
                {MODES.map((mode) => {
                  const active = selectedModeId === mode.id;
                  return (
                    <TouchableOpacity
                      key={mode.id}
                      activeOpacity={0.9}
                      onPress={() => {
                        hapticSelection();
                        setMenuOpen(false);
                        navigation.navigate("FullGuide", { modeId: mode.id });
                      }}
                      style={[cameraStyles.menuGuideButton, active && cameraStyles.menuGuideButtonActive]}
                    >
                      <View style={[cameraStyles.menuGuideIcon, active && cameraStyles.menuGuideIconActive]}>
                        <Feather name={mode.guideIcon} size={15} color={active ? "#091220" : colors.primary} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[cameraStyles.menuGuideButtonText, active && cameraStyles.menuGuideButtonTextActive]}>
                          {mode.guideLabel}
                        </Text>
                        <Text style={[cameraStyles.menuGuideHint, active && cameraStyles.menuGuideButtonTextActive]}>
                          {mode.guideHint}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>
          </View>
        ) : null}

        <View style={cameraStyles.captureTray}>
          <View style={cameraStyles.captureSideSlot}>
            <TouchableOpacity
              ref={setAppGuideTargetRef("historyButton")}
              collapsable={false}
              activeOpacity={0.85}
              accessibilityLabel="Open session history"
              onPress={() => {
                hapticSelection();
                navigation.navigate("SessionHistory");
              }}
              disabled={sideCaptureControlsDisabled}
              style={[cameraStyles.captureSideButton, sideCaptureControlsDisabled && cameraStyles.disabledControl]}
            >
              <Feather name="clock" size={19} color={colors.text} />
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            ref={setAppGuideTargetRef("recordButton")}
            collapsable={false}
            activeOpacity={0.85}
            onPress={recordButtonAction}
            disabled={recordButtonDisabled}
            style={[
              cameraStyles.recordButton,
              recording && cameraStyles.recordButtonActive,
              recordButtonDisabled && cameraStyles.disabledControl,
            ]}
          >
            <View style={[cameraStyles.recordButtonInner, recording && cameraStyles.recordButtonStop]} />
          </TouchableOpacity>
          <View style={cameraStyles.captureSideSlot}>
            <TouchableOpacity
              ref={setAppGuideTargetRef("cameraSwitchButton")}
              collapsable={false}
              activeOpacity={0.85}
              accessibilityLabel={`Switch camera. Current camera: ${cameraFacingLabel}`}
              onPress={toggleCameraFacing}
              disabled={sideCaptureControlsDisabled}
              style={[cameraStyles.captureSideButton, sideCaptureControlsDisabled && cameraStyles.disabledControl]}
            >
              <Feather name="rotate-cw" size={19} color={colors.text} />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <View
        ref={setAppGuideTargetRef("sheetBody")}
        collapsable={false}
        style={[
          cameraStyles.sessionSheet,
          !bottomModeTrayOpen && cameraStyles.sessionSheetCollapsed,
          bottomModeTrayOpen && cameraStyles.sessionSheetExpanded,
        ]}
      >
        <View
          ref={setAppGuideTargetRef("sheetHandle")}
          collapsable={false}
          style={[cameraStyles.sheetDragHeader, !bottomModeTrayOpen && cameraStyles.sheetDragHeaderCollapsed]}
          {...sheetDragResponder.panHandlers}
        >
          <View style={[cameraStyles.sheetHandle, !bottomModeTrayOpen && cameraStyles.sheetHandleCollapsed]} />
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => setBottomModeTrayOpen(!bottomModeTrayOpen)}
            style={[cameraStyles.modeTrayHeader, !bottomModeTrayOpen && cameraStyles.modeTrayHeaderCollapsed]}
          >
            <View style={{ flex: 1 }}>
              <Text style={cameraStyles.sheetEyebrow}>Current Mode</Text>
              <Text style={cameraStyles.sheetTitle}>{activeMode.title}</Text>
              <Text style={[cameraStyles.sheetCopy, !bottomModeTrayOpen && cameraStyles.sheetCopyCollapsed]}>
                {bottomModeTrayOpen ? "Drag down to hide this card." : "Drag up to choose a mode."}
              </Text>
            </View>
          </TouchableOpacity>
        </View>

        {bottomModeTrayOpen ? (
          <ScrollView
            ref={sheetContentScrollRef}
            style={cameraStyles.sessionSheetBody}
            contentContainerStyle={cameraStyles.sessionSheetContent}
            showsVerticalScrollIndicator
            bounces
          >
            <View
              ref={setAppGuideTargetRef("modePicker")}
              collapsable={false}
              onLayout={setAppGuideContentLayout("modePicker")}
              style={cameraStyles.bottomModeGrid}
            >
                {MODES.map((mode) => {
                  const active = selectedModeId === mode.id;
                  return (
                    <TouchableOpacity
                      key={mode.id}
                      activeOpacity={0.9}
                      onPress={() => handleModeChange(mode.id)}
                      disabled={busyWithAnalysis || recording}
                      style={[cameraStyles.bottomModeOption, active && cameraStyles.bottomModeOptionActive]}
                    >
                      <Text style={[cameraStyles.bottomModeTag, active && cameraStyles.bottomModeTextActive]}>{mode.tag}</Text>
                      <Text style={[cameraStyles.bottomModeTitle, active && cameraStyles.bottomModeTextActive]}>
                        {mode.title}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={cameraStyles.bottomTrayLabel}>Output</Text>
              <View
                ref={setAppGuideTargetRef("outputPicker")}
                collapsable={false}
                onLayout={setAppGuideContentLayout("outputPicker")}
                style={cameraStyles.bottomOutputRow}
              >
                {COACHING_OVERLAY_OPTIONS.map((option) => (
                  <TouchableOpacity
                    key={option.id}
                    activeOpacity={0.9}
                    onPress={() => {
                      hapticSelection();
                      setOverlayMode(option.id);
                    }}
                    disabled={busyWithAnalysis}
                    style={[cameraStyles.overlayPill, option.id === overlayMode && cameraStyles.overlayPillActive]}
                  >
                    <Text style={[cameraStyles.overlayPillText, option.id === overlayMode && cameraStyles.overlayPillTextActive]}>
                      {option.title}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            <View style={cameraStyles.sessionStatusRow}>
              <Text style={cameraStyles.sheetCopy}>{recordingStatus}</Text>
            </View>

          <SetupGuidePanel guide={setupGuide} />

          <View style={cameraStyles.clipPanel}>
            <Text style={cameraStyles.clipLabel}>Clip</Text>
            <Text style={cameraStyles.clipValue}>{selectedVideoLabel}</Text>
            <Text style={cameraStyles.clipHelp}>
              Record or upload a clip. The backend analyzes it with YOLOv11 basketball detection and MediaPipe pose tracking.
            </Text>
            <View style={cameraStyles.orientationPanel}>
              <Text style={cameraStyles.orientationLabel}>Clip Orientation</Text>
              {videoSource === "upload" ? (
                <View style={cameraStyles.orientationChoiceRow}>
                  {SOURCE_ORIENTATION_OPTIONS.map((option) => {
                    const active = sourceOrientation === option.id;
                    return (
                      <TouchableOpacity
                        key={option.id}
                        activeOpacity={0.9}
                        onPress={() => {
                          hapticSelection();
                          setSourceOrientation(option.id);
                        }}
                        disabled={busyWithAnalysis}
                        style={[cameraStyles.orientationPill, active && cameraStyles.orientationPillActive]}
                      >
                        <Text style={[cameraStyles.orientationPillText, active && cameraStyles.orientationPillTextActive]}>
                          {option.title}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ) : (
                <Text style={cameraStyles.orientationValue}>{sourceOrientationLabel}</Text>
              )}
            </View>
            <View style={cameraStyles.backendStatusRow}>
              <View
                style={[
                  cameraStyles.backendDot,
                  {
                    backgroundColor:
                      backendStatus.ready === null
                        ? colors.warning
                        : backendStatus.ready
                          ? colors.success
                          : colors.danger,
                  },
                ]}
              />
              <Text
                style={[
                  cameraStyles.backendStatusText,
                  { color: backendStatus.ready === false ? colors.danger : colors.muted },
                ]}
              >
                {backendStatus.label}
              </Text>
            </View>
          </View>

        <View
          ref={setAppGuideTargetRef("clipActions")}
          collapsable={false}
          onLayout={setAppGuideContentLayout("clipActions")}
          style={cameraStyles.sheetActionRow}
        >
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={pickVideo}
            disabled={busyWithAnalysis || recording}
            style={[cameraStyles.sheetSecondaryAction, (busyWithAnalysis || recording) && cameraStyles.disabledControl]}
          >
            <Feather name="upload" size={17} color={colors.text} />
            <Text style={cameraStyles.sheetSecondaryActionText}>Upload Clip</Text>
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={handleStartSession}
            disabled={!selectedVideo || busyWithAnalysis || recording || backendUnavailable}
            style={[
              cameraStyles.sheetPrimaryAction,
              (!selectedVideo || busyWithAnalysis || recording || backendUnavailable) && cameraStyles.disabledControl,
            ]}
          >
            <Feather name="activity" size={17} color="#091220" />
            <Text style={cameraStyles.sheetPrimaryActionText}>{busyWithAnalysis ? "Busy" : "Analyze"}</Text>
          </TouchableOpacity>
        </View>

        {bottomModeTrayOpen || busyWithAnalysis || progress > 0 ? (
          <View style={cameraStyles.progressRow}>
            <Text style={cameraStyles.progressLabel}>Progress</Text>
            <View style={cameraStyles.progressTrack}>
              <View style={[cameraStyles.progressFill, { width: `${displayedProgress}%` }]} />
            </View>
            <Text style={cameraStyles.progressNumber}>{displayedProgress}%</Text>
          </View>
        ) : null}

        {status === "uploading" || uploadProgress > 0 ? (
          <View style={cameraStyles.progressRow}>
            <Text style={cameraStyles.progressLabel}>Upload</Text>
            <View style={cameraStyles.progressTrack}>
              <View style={[cameraStyles.uploadProgressFill, { width: `${displayedUploadProgress}%` }]} />
            </View>
            <Text style={cameraStyles.progressNumber}>{displayedUploadProgress}%</Text>
          </View>
        ) : null}

        {busyWithAnalysis ? (
          <View style={cameraStyles.controlRow}>
            <TouchableOpacity activeOpacity={0.9} onPress={handleCancelSession} style={cameraStyles.cancelButton}>
              <Feather name="x-circle" size={16} color={colors.danger} />
              <Text style={cameraStyles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {(status === "error" || status === "cancelled") && selectedVideo ? (
          <View style={cameraStyles.controlRow}>
            <TouchableOpacity activeOpacity={0.9} onPress={handleStartSession} style={cameraStyles.retryButton}>
              <Feather name="refresh-cw" size={16} color="#091220" />
              <Text style={cameraStyles.retryButtonText}>Retry Analysis</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <Text style={cameraStyles.sheetCopy}>Analyzed frames: {coachingResults.analyzedFrames}</Text>

        <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
          <StatCard label="Average" value={coachingResults.averageScore.toFixed(1)} color={colors.secondary} />
          <StatCard label="Best" value={coachingResults.bestScore || "--"} color={colors.success} />
          <StatCard label="Worst" value={coachingResults.worstScore || "--"} color={colors.warning} />
        </View>

        <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
          <StatCard label="Grade" value={coachingResults.classification || "--"} color={colors.primary} />
          <StatCard label="Mode" value={activeMode.title} color={colors.accent} />
        </View>

        {coachingResults.actionLabel ? (
          <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
            <StatCard label={coachingResults.actionLabel} value={coachingResults.actionCount} color={colors.text} />
            <StatCard label="Tracking" value="YOLO + Pose" color={colors.secondary} />
          </View>
        ) : null}

        {selectedModeId === "shooting_form" ? (
          <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
            <StatCard label="Makes" value={coachingResults.shootingStats?.makes || 0} color={colors.success} />
            <StatCard label="Misses" value={coachingResults.shootingStats?.misses || 0} color={colors.warning} />
            <StatCard
              label="Accuracy"
              value={`${Number(coachingResults.shootingStats?.accuracy || 0).toFixed(1)}%`}
              color={colors.primary}
            />
          </View>
        ) : null}

        {coachingResults.analyzedFrames > 0 ? (
          <CoachReviewPanel
            review={coachReview}
            reviewLevel={reviewLevel}
            onReviewLevelChange={setReviewLevel}
            score={coachingResults.averageScore}
            classification={coachingResults.classification}
          />
        ) : null}

        {coachingResults.analyzedFrames > 0 ? <ScoreReasonPanel reasons={scoreReasons} /> : null}

        {coachingResults.analyzedFrames > 0 && coachingResults.phaseScores.length > 0 ? (
          <PhaseScorePanel phases={coachingResults.phaseScores} />
        ) : null}

        {coachingResults.analyzedFrames > 0 ? (
          <PoseComparisonPanel comparison={coachingResults.poseComparison} />
        ) : null}

        {selectedModeId === "shooting_form" && reviewShotEvents.length > 0 ? (
          <ShotReviewPanel shotEvents={reviewShotEvents} reviewLevel={reviewLevel} />
        ) : null}

        {selectedModeId !== "shooting_form" && modeReview ? (
          <ModeReviewPanel review={modeReview} reviewLevel={reviewLevel} />
        ) : null}

        {reviewLevel === "intermediate" && coachingResults.analyzedFrames > 0 ? (
          <View style={cameraStyles.explanationPanel}>
            <Text style={cameraStyles.clipLabel}>Score Details</Text>
            {scoreExplanation.map((item) => (
              <View key={item.label} style={cameraStyles.explanationRow}>
                <Text style={cameraStyles.explanationLabel}>{item.label}</Text>
                <Text style={cameraStyles.explanationValue}>{item.value}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {reviewLevel === "intermediate" && coachingResults.dominantFeedback.length > 0 ? (
          <View style={cameraStyles.focusPanel}>
            <Text style={cameraStyles.clipLabel}>Top Focus Areas</Text>
            {coachingResults.dominantFeedback.map((item, index) => (
              <Text key={`${item}-${index}`} style={cameraStyles.focusText}>
                {item}
              </Text>
            ))}
          </View>
        ) : null}

        {reviewLevel === "intermediate" && coachingResults.summary ? <Text style={cameraStyles.summaryText}>{coachingResults.summary}</Text> : null}
        {errorMessage ? <Text style={cameraStyles.errorText}>{errorMessage}</Text> : null}
        {archiveMessage ? (
          <Text style={[cameraStyles.archiveText, archiveMessageTone === "success" ? { color: colors.success } : { color: colors.warning }]}>
            {archiveMessage}
          </Text>
        ) : null}

        {resultVideoUrl ? (
          <>
            <View style={cameraStyles.resultVideoFrame}>
              <ResultVideoPlayer
                videoUrl={resultVideoUrl}
                reviewEvents={reviewMoments}
                outputWidth={coachingResults.outputWidth}
                outputHeight={coachingResults.outputHeight}
                speechText={coachingSpeechText}
              />
            </View>
            <PrimaryButton title="Download Video" onPress={openResultVideo} />
          </>
        ) : null}
          </ScrollView>
        ) : null}
      </View>

      {appGuideVisible && appGuideStep ? (
        <AppGuideOverlay
          step={appGuideStep}
          stepIndex={appGuideStepIndex}
          totalSteps={APP_GUIDE_STEPS.length}
          targetLayout={appGuideTargetLayout}
          viewportWidth={viewportWidth}
          viewportHeight={viewportHeight}
          onBack={() => setAppGuideStepIndex((current) => Math.max(0, current - 1))}
          onNext={() => {
            if (appGuideStepIndex >= APP_GUIDE_STEPS.length - 1) {
              void completeAppGuide(true);
              return;
            }
            setAppGuideStepIndex((current) => Math.min(APP_GUIDE_STEPS.length - 1, current + 1));
          }}
          onSkip={() => void completeAppGuide(true)}
        />
      ) : null}
    </View>
  );
}

function AppGuideOverlay({
  step,
  stepIndex,
  totalSteps,
  targetLayout,
  viewportWidth,
  viewportHeight,
  onBack,
  onNext,
  onSkip,
}) {
  const highlight = targetLayout
    ? {
        left: Math.max(10, targetLayout.x - 8),
        top: Math.max(10, targetLayout.y - 8),
        width: Math.min(viewportWidth - 20, targetLayout.width + 16),
        height: Math.min(viewportHeight - Math.max(10, targetLayout.y - 8) - 10, targetLayout.height + 16),
      }
    : null;
  const panelWidth = Math.min(viewportWidth - 32, 360);
  const estimatedPanelHeight = 178;
  const panelTop =
    highlight && highlight.top > viewportHeight * 0.45
      ? 44
      : Math.max(44, viewportHeight - estimatedPanelHeight - 22);
  const isLast = stepIndex >= totalSteps - 1;

  return (
    <View style={cameraStyles.appGuideOverlay} pointerEvents="box-none">
      <View style={cameraStyles.appGuideScrim} pointerEvents="none" />
      {highlight ? <View pointerEvents="none" style={[cameraStyles.appGuideHighlight, highlight]} /> : null}
      <View style={[cameraStyles.appGuidePanel, { top: panelTop, width: panelWidth }]}>
        <Text style={cameraStyles.appGuideStepText}>
          Step {stepIndex + 1} of {totalSteps}
        </Text>
        <Text style={cameraStyles.appGuideTitle}>{step.title}</Text>
        <Text style={cameraStyles.appGuideBody}>{step.body}</Text>
        <View style={cameraStyles.appGuideActionRow}>
          <TouchableOpacity activeOpacity={0.85} onPress={onSkip} style={cameraStyles.appGuideSecondaryButton}>
            <Text style={cameraStyles.appGuideSecondaryText}>Skip</Text>
          </TouchableOpacity>
          <View style={cameraStyles.appGuideNavButtons}>
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={onBack}
              disabled={stepIndex === 0}
              style={[cameraStyles.appGuideSmallButton, stepIndex === 0 && cameraStyles.disabledControl]}
            >
              <Text style={cameraStyles.appGuideSmallButtonText}>Back</Text>
            </TouchableOpacity>
            <TouchableOpacity activeOpacity={0.9} onPress={onNext} style={cameraStyles.appGuidePrimaryButton}>
              <Text style={cameraStyles.appGuidePrimaryText}>{isLast ? "Done" : "Next"}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </View>
  );
}

function SetupGuidePanel({ guide }) {
  return (
    <View style={cameraStyles.setupGuidePanel}>
      <View style={cameraStyles.setupGuideHeader}>
        <Feather name="target" size={16} color={colors.primary} />
        <Text style={cameraStyles.clipLabel}>{guide.title}</Text>
      </View>
      {guide.tips.map((tip) => (
        <View key={tip} style={cameraStyles.setupTipRow}>
          <View style={cameraStyles.setupTipDot} />
          <Text style={cameraStyles.setupTipText}>{tip}</Text>
        </View>
      ))}
      <View style={cameraStyles.poseReferenceCard}>
        <View style={cameraStyles.tutorialHeaderRow}>
          <View style={cameraStyles.tutorialIcon}>
            <Feather name="play" size={13} color={colors.primary} />
          </View>
          <Text style={cameraStyles.poseReferenceTitle}>Video Tutorial</Text>
        </View>
        <CorePoseTutorialVideo
          source={guide.tutorialVideo || guide.motionGif}
          fallbackImage={guide.image}
          accessibilityLabel={guide.imageAlt}
        />
        <TouchableOpacity
          accessibilityLabel={`Open tutorial source from ${guide.tutorialCredit}`}
          activeOpacity={0.82}
          onPress={() => void Linking.openURL(guide.tutorialUrl)}
          style={cameraStyles.tutorialAttribution}
        >
          <Feather name="external-link" size={13} color={colors.secondary} />
          <Text style={cameraStyles.tutorialAttributionText}>Source: {guide.tutorialCredit}</Text>
        </TouchableOpacity>
        <Text style={cameraStyles.corePoseSequenceTitle}>Complete Core Pose Sequence</Text>
        {(guide.corePosePhases || []).map((phase) => (
          <View key={phase.label} style={cameraStyles.corePosePhaseRow}>
            <Text style={cameraStyles.corePosePhaseLabel}>{phase.label}</Text>
            <Text style={cameraStyles.corePosePhaseCue}>{phase.cue}</Text>
          </View>
        ))}
        {guide.poseCues.map((cue) => (
          <View key={cue} style={cameraStyles.poseCueRow}>
            <View style={cameraStyles.poseCueDot} />
            <Text style={cameraStyles.poseCueText}>{cue}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function PoseComparisonPanel({ comparison = [] }) {
  const metrics = Array.isArray(comparison) ? comparison : [];
  const measuredCount = metrics.filter((metric) => metric.status !== "insufficient").length;

  return (
    <View style={cameraStyles.poseComparisonPanel}>
      <View style={cameraStyles.poseComparisonHeader}>
        <View style={{ flex: 1 }}>
          <Text style={cameraStyles.clipLabel}>Your Pose vs Tutorial Reference</Text>
          <Text style={cameraStyles.poseComparisonIntro}>
            Clip medians and frame-match rates are compared with SureBall's operational ranges for the same core
            drill phases taught in the tutorial video.
          </Text>
        </View>
        <View style={cameraStyles.measuredPill}>
          <Text style={cameraStyles.measuredPillText}>{measuredCount}/{metrics.length} MEASURED</Text>
        </View>
      </View>

      <Text style={cameraStyles.poseComparisonGuideNote}>
        For the tutorial video and looping GIF, open the Full Guide before recording. This section only summarizes how
        the uploaded clip matched the reference ranges.
      </Text>

      {metrics.map((metric) => {
        const statusColor =
          metric.status === "matched"
            ? colors.success
            : metric.status === "close"
              ? colors.warning
              : metric.status === "needs_focus"
                ? colors.danger
                : colors.muted;
        const statusLabel =
          metric.status === "matched"
            ? "Matched"
            : metric.status === "close"
              ? "Close"
              : metric.status === "needs_focus"
                ? "Needs Focus"
                : "Not Detected";
        return (
          <View key={metric.key} style={cameraStyles.poseMetricCard}>
            <View style={cameraStyles.poseMetricHeader}>
              <Text style={cameraStyles.poseMetricLabel}>{metric.label}</Text>
              <View style={[cameraStyles.poseMetricStatus, { borderColor: statusColor }]}>
                <Text style={[cameraStyles.poseMetricStatusText, { color: statusColor }]}>{statusLabel}</Text>
              </View>
            </View>
            <View style={cameraStyles.poseMetricValues}>
              <View style={cameraStyles.poseMetricValueColumn}>
                <Text style={cameraStyles.poseMetricEyebrow}>YOUR CLIP MEDIAN</Text>
                <Text style={cameraStyles.poseMetricValue}>{metric.actual_display}</Text>
              </View>
              <View style={cameraStyles.poseMetricValueColumn}>
                <Text style={cameraStyles.poseMetricEyebrow}>REFERENCE RANGE</Text>
                <Text style={cameraStyles.poseMetricValue}>{metric.reference_display}</Text>
              </View>
            </View>
            <View style={cameraStyles.poseMatchTrack}>
              <View style={[cameraStyles.poseMatchFill, { width: `${clampPercent(metric.match_rate)}%`, backgroundColor: statusColor }]} />
            </View>
            <Text style={cameraStyles.poseMetricFootnote}>
              {Number(metric.match_rate || 0).toFixed(1)}% of {metric.observed_frames || 0} measured frames matched. {metric.coaching_cue}
            </Text>
          </View>
        );
      })}
      <Text style={cameraStyles.poseComparisonDisclaimer}>
        Reference ranges are rule-based coaching targets for this prototype, not a medical diagnosis or a replacement for a professional coach.
      </Text>
    </View>
  );
}

function ScoreReasonPanel({ reasons }) {
  return (
    <View style={cameraStyles.scoreReasonPanel}>
      <Text style={cameraStyles.clipLabel}>Why This Score</Text>
      <Text style={cameraStyles.scoreReasonIntro}>Main reasons SureBall judged this clip the way it did.</Text>
      {reasons.map((reason) => {
        const color = reason.tone === "good" ? colors.success : reason.tone === "warning" ? colors.warning : colors.secondary;
        return (
          <View key={reason.label} style={cameraStyles.scoreReasonRow}>
            <View style={[cameraStyles.scoreReasonDot, { backgroundColor: color }]} />
            <View style={{ flex: 1 }}>
              <Text style={cameraStyles.scoreReasonLabel}>{reason.label}</Text>
              <Text style={cameraStyles.scoreReasonText}>{reason.text}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

function phaseStatusColor(status) {
  if (status === "excellent") return colors.success;
  if (status === "good") return colors.secondary;
  if (status === "developing") return colors.warning;
  if (status === "needs_focus") return colors.danger;
  return colors.muted;
}

function phaseStatusLabel(status) {
  if (status === "excellent") return "Excellent";
  if (status === "good") return "Good";
  if (status === "developing") return "Developing";
  if (status === "needs_focus") return "Needs Focus";
  return "Not Observed";
}

function PhaseScorePanel({ phases }) {
  return (
    <View style={cameraStyles.phaseScorePanel}>
      <Text style={cameraStyles.clipLabel}>Key Phase Scores</Text>
      <Text style={cameraStyles.phaseScoreIntro}>
        SureBall groups frames into drill phases from the tutorial reference for review only. These phase cards do not
        change the main Average score.
      </Text>
      <View style={cameraStyles.phaseScoreGrid}>
        {phases.map((phase) => {
          const color = phaseStatusColor(phase.status);
          const score = Number(phase.averageScore || 0);
          return (
            <View key={phase.key} style={[cameraStyles.phaseScoreCard, { borderColor: color }]}>
              <View style={cameraStyles.phaseScoreHeader}>
                <Text style={cameraStyles.phaseScoreLabel}>{phase.label}</Text>
                <Text style={[cameraStyles.phaseScoreStatus, { color }]}>{phaseStatusLabel(phase.status)}</Text>
              </View>
              <View style={cameraStyles.phaseScoreTrack}>
                <View style={[cameraStyles.phaseScoreFill, { width: `${clampPercent(score)}%`, backgroundColor: color }]} />
              </View>
              <Text style={cameraStyles.phaseScoreValue}>
                {phase.frameCount > 0 ? `${score.toFixed(1)} from ${phase.frameCount} frames` : "No reliable frames"}
              </Text>
              <Text style={cameraStyles.phaseScoreCue}>{phase.cue || phase.focus}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function CoachReviewPanel({
  review,
  reviewLevel,
  onReviewLevelChange,
  score,
  classification,
}) {
  return (
    <View style={cameraStyles.coachReviewPanel}>
      <View style={cameraStyles.reviewHeaderRow}>
        <View style={{ flex: 1 }}>
          <Text style={cameraStyles.clipLabel}>Coach Review</Text>
          <Text style={cameraStyles.reviewTitle}>Main Focus</Text>
        </View>
        <View style={[cameraStyles.trackingPill, { borderColor: review.tracking.color }]}>
          <Text style={[cameraStyles.trackingPillText, { color: review.tracking.color }]}>
            {review.tracking.label} Tracking
          </Text>
        </View>
      </View>
      <View style={cameraStyles.reviewLevelSelector}>
        {REVIEW_LEVELS.map((level) => {
          const active = reviewLevel === level.id;
          return (
            <TouchableOpacity
              key={level.id}
              activeOpacity={0.9}
              onPress={() => {
                hapticSelection();
                onReviewLevelChange(level.id);
              }}
              style={[cameraStyles.reviewLevelButton, active && cameraStyles.reviewLevelButtonActive]}
            >
              <Text style={[cameraStyles.reviewLevelText, active && cameraStyles.reviewLevelTextActive]}>{level.title}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <Text style={cameraStyles.reviewMainText}>{review.mainFocus}</Text>
      {review.tracking.label !== "Good" ? (
        <View style={[cameraStyles.trackingWarning, { borderColor: review.tracking.color }]}>
          <Feather name="alert-triangle" size={15} color={review.tracking.color} />
          <Text style={cameraStyles.trackingWarningText}>{review.tracking.text}</Text>
        </View>
      ) : null}
      <View style={cameraStyles.reviewInfoRow}>
        <View style={cameraStyles.reviewInfoItem}>
          <Text style={cameraStyles.reviewInfoLabel}>Skill Score</Text>
          <Text style={cameraStyles.reviewInfoValue}>{Number(score || 0).toFixed(1)}</Text>
          <Text style={cameraStyles.reviewInfoHelp}>{classification || "Review"}</Text>
        </View>
        <View style={cameraStyles.reviewInfoItem}>
          <Text style={cameraStyles.reviewInfoLabel}>Tracking Quality</Text>
          <Text style={[cameraStyles.reviewInfoValue, { color: review.tracking.color }]}>{review.tracking.label}</Text>
          <Text style={cameraStyles.reviewInfoHelp}>{review.tracking.text}</Text>
        </View>
      </View>
      <Text style={cameraStyles.reviewCoachText}>
        {reviewLevel === "intermediate"
          ? "Intermediate view adds the score breakdown and full focus list below."
          : review.scoreText}
      </Text>
    </View>
  );
}

function ShotReviewPanel({ shotEvents, reviewLevel }) {
  return (
    <View style={cameraStyles.shotReviewPanel}>
      <Text style={cameraStyles.clipLabel}>Shot-By-Shot Review</Text>
      <Text style={cameraStyles.shotReviewIntro}>
        {reviewLevel === "intermediate"
          ? "Use each shot to compare setup, release, ball path, and landing."
          : "Use these cards while watching the annotated video."}
      </Text>
      <View style={cameraStyles.shotReviewGrid}>
        {shotEvents.map((event) => {
          const resultColor = shotResultColor(event.result);
          const resultTime = event.resultTimestampSeconds ?? event.timestampSeconds;
          return (
            <View
              key={`${event.shotNumber}-${event.timestampSeconds}`}
              style={[cameraStyles.shotReviewCard, { borderColor: resultColor }]}
            >
              <View style={cameraStyles.shotReviewHeader}>
                <Text style={cameraStyles.shotReviewTitle}>Shot {event.shotNumber}</Text>
                <Text style={[cameraStyles.shotReviewResult, { color: resultColor }]}>{formatShotResult(event.result)}</Text>
              </View>
              <Text style={cameraStyles.shotReviewTime}>{formatShotTime(resultTime)}</Text>
              <View style={cameraStyles.shotReviewMetaRow}>
                <Text style={cameraStyles.shotReviewMetaPill}>Jump: {formatShotTime(event.reviewSeconds)}</Text>
                {event.resultQuality ? (
                  <Text style={[cameraStyles.shotReviewMetaPill, { color: resultQualityColor(event.resultQuality) }]}>
                    Quality: {formatResultQuality(event.resultQuality)}
                  </Text>
                ) : null}
              </View>
              <Text style={cameraStyles.shotReviewText}>{shotFeedbackText(event.result, reviewLevel)}</Text>
              <Text style={cameraStyles.shotReviewReason}>{shotReasonText(event, reviewLevel)}</Text>
              {event.evidence.length ? (
                <View style={cameraStyles.shotEvidenceList}>
                  {event.evidence.slice(0, 3).map((item) => (
                    <View key={`${event.shotNumber}-${item}`} style={cameraStyles.shotEvidenceRow}>
                      <View style={cameraStyles.shotEvidenceDot} />
                      <Text style={cameraStyles.shotEvidenceText}>{item}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}

function ModeReviewPanel({ review, reviewLevel }) {
  return (
    <View style={cameraStyles.modeReviewPanel}>
      <View style={cameraStyles.modeReviewHeader}>
        <View style={{ flex: 1 }}>
          <Text style={cameraStyles.clipLabel}>{review.title}</Text>
          <Text style={cameraStyles.modeReviewIntro}>{review.intro}</Text>
        </View>
        <View style={cameraStyles.modeActionCount}>
          <Text style={cameraStyles.modeActionValue}>{review.actionValue}</Text>
          <Text style={cameraStyles.modeActionLabel}>{review.actionLabel}</Text>
        </View>
      </View>
      <View style={cameraStyles.modeReviewGrid}>
        {review.sections.map((section) => (
          <View key={section.label} style={[cameraStyles.modeReviewCard, { borderColor: section.color }]}>
            <Text style={cameraStyles.modeReviewLabel}>{section.label}</Text>
            <Text style={[cameraStyles.modeReviewStatus, { color: section.color }]}>{section.status}</Text>
            <Text style={cameraStyles.modeReviewTip}>{section.tip}</Text>
          </View>
        ))}
      </View>
      {review.moments?.length ? (
        <View style={cameraStyles.modeMomentGrid}>
          {review.moments.map((moment) => (
            <View key={`${moment.label}-${moment.title}`} style={[cameraStyles.modeMomentCard, { borderColor: moment.color }]}>
              <Text style={cameraStyles.modeMomentLabel}>{moment.label}</Text>
              <Text style={cameraStyles.modeMomentTitle}>{moment.title}</Text>
              <Text style={cameraStyles.modeMomentTime}>{formatShotTime(moment.time)}</Text>
              <Text style={cameraStyles.modeMomentText}>{moment.text}</Text>
            </View>
          ))}
        </View>
      ) : null}
      <Text style={cameraStyles.modeReviewCue}>
        {reviewLevel === "intermediate" ? review.intermediateCue : review.beginnerCue}
      </Text>
    </View>
  );
}

function ResultVideoPlayer({ videoUrl, reviewEvents = [], outputWidth = 0, outputHeight = 0, speechText = "" }) {
  const player = useVideoPlayer(
    {
      uri: videoUrl,
      useCaching: true,
    },
    (instance) => {
      instance.loop = true;
      instance.play();
    }
  );
  const { isPlaying } = useEvent(player, "playingChange", { isPlaying: player.playing });
  const [coachingAudioEnabled, setCoachingAudioEnabled] = useState(true);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speechStatus, setSpeechStatus] = useState(
    speechText.trim() ? "Voice cues are ready for this review." : "Voice cues are not available for this review."
  );
  const spokenVideoRef = useRef(null);
  const speechMountedRef = useRef(true);
  const videoMoments = Array.isArray(reviewEvents) ? reviewEvents : [];
  const outputIsLandscape = Number(outputWidth || 0) > Number(outputHeight || 0);
  const videoHeight = outputIsLandscape ? 220 : 340;

  const speakCoachingFeedback = useCallback(() => {
    const text = speechText.trim();
    if (!text) {
      setSpeechStatus("No coaching voice text was generated for this review.");
      return;
    }
    if (speechMountedRef.current) {
      setIsSpeaking(true);
      setSpeechStatus("Playing coaching voice cues...");
    }
    Speech.stop();
    Speech.speak(text, {
      language: "en-US",
      pitch: 1,
      rate: 0.92,
      onDone: () => {
        if (!speechMountedRef.current) {
          return;
        }
        setIsSpeaking(false);
        setSpeechStatus("Voice cues finished. Tap Play Voice Cues to hear them again.");
      },
      onStopped: () => {
        if (!speechMountedRef.current) {
          return;
        }
        setIsSpeaking(false);
        setSpeechStatus("Voice cues stopped.");
      },
      onError: (error) => {
        if (!speechMountedRef.current) {
          return;
        }
        setIsSpeaking(false);
        setSpeechStatus(
          `Voice cues could not play. Check the device media volume and Text-to-Speech settings. ${String(
            error?.message || error || ""
          ).trim()}`
        );
      },
    });
  }, [speechText]);

  useEffect(() => {
    spokenVideoRef.current = null;
    setSpeechStatus(speechText.trim() ? "Voice cues are ready for this review." : "Voice cues are not available for this review.");
  }, [speechText, videoUrl]);

  useEffect(() => {
    if (!coachingAudioEnabled || !speechText.trim() || spokenVideoRef.current === videoUrl) {
      return undefined;
    }
    const timer = setTimeout(() => {
      spokenVideoRef.current = videoUrl;
      speakCoachingFeedback();
    }, isPlaying ? 650 : 1100);
    return () => clearTimeout(timer);
  }, [coachingAudioEnabled, isPlaying, speakCoachingFeedback, speechText, videoUrl]);

  useEffect(
    () => () => {
      speechMountedRef.current = false;
      Speech.stop();
    },
    []
  );

  function jumpToMoment(event) {
    hapticSelection();
    player.currentTime = Number(event.reviewSeconds || 0);
    player.play();
  }

  return (
    <View>
      <VideoView
        style={{ width: "100%", height: videoHeight, backgroundColor: "#040b15" }}
        player={player}
        nativeControls
        allowsFullscreen
        contentFit="contain"
      />
      <View style={{ padding: 14, borderTopWidth: 1, borderTopColor: colors.border }}>
        <TouchableOpacity
          activeOpacity={0.9}
          onPress={() => {
            if (isPlaying) {
              player.pause();
            } else {
              player.play();
              if (coachingAudioEnabled && speechText.trim() && spokenVideoRef.current !== videoUrl) {
                spokenVideoRef.current = videoUrl;
                setTimeout(speakCoachingFeedback, 250);
              }
            }
          }}
          style={{
            borderRadius: 14,
            borderWidth: 1,
            borderColor: colors.primary,
            backgroundColor: "rgba(255, 122, 26, 0.12)",
            paddingVertical: 12,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ color: colors.primary, fontSize: 14, fontWeight: "800" }}>
            {isPlaying ? "Pause Preview" : "Play Preview"}
          </Text>
        </TouchableOpacity>
        <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
          <TouchableOpacity
            accessibilityLabel="Replay coaching audio"
            activeOpacity={0.9}
            onPress={() => {
              if (isSpeaking) {
                Speech.stop();
                return;
              }
              speakCoachingFeedback();
            }}
            style={{
              flex: 1,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: colors.secondary,
              paddingVertical: 11,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Feather name={isSpeaking ? "volume-x" : "volume-2"} size={16} color={colors.secondary} />
            <Text style={{ marginTop: 4, color: colors.secondary, fontSize: 12, fontWeight: "800" }}>
              {isSpeaking ? "Stop Voice" : "Play Voice Cues"}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityLabel={coachingAudioEnabled ? "Mute coaching audio" : "Enable coaching audio"}
            activeOpacity={0.9}
            onPress={() => {
              if (coachingAudioEnabled) {
                Speech.stop();
                setIsSpeaking(false);
                setCoachingAudioEnabled(false);
                setSpeechStatus("Auto voice is off. Tap Play Voice Cues if you still want to hear the feedback.");
                return;
              }
              setCoachingAudioEnabled(true);
              spokenVideoRef.current = videoUrl;
              speakCoachingFeedback();
            }}
            style={{
              flex: 1,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: colors.border,
              paddingVertical: 11,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Feather name={coachingAudioEnabled ? "volume-x" : "volume-2"} size={16} color={colors.text} />
            <Text style={{ marginTop: 4, color: colors.text, fontSize: 12, fontWeight: "800" }}>
              {coachingAudioEnabled ? "Auto Voice On" : "Auto Voice Off"}
            </Text>
          </TouchableOpacity>
        </View>
        <Text selectable style={{ marginTop: 10, color: colors.muted, fontSize: 12, lineHeight: 18 }}>
          {speechStatus}
        </Text>
        {videoMoments.length > 0 ? (
          <View style={cameraStyles.videoShotJumpPanel}>
            <Text style={cameraStyles.clipLabel}>Jump To Review</Text>
            <View style={cameraStyles.videoShotJumpRow}>
              {videoMoments.map((event, index) => {
                const resultColor = shotResultColor(event.result);
                const momentLabel = event.label || `Shot ${event.shotNumber || index + 1}`;
                const resultTime = event.resultTimestampSeconds ?? event.timestampSeconds;
                return (
                  <TouchableOpacity
                    key={`${momentLabel}-${event.reviewSeconds ?? index}`}
                    activeOpacity={0.85}
                    onPress={() => jumpToMoment(event)}
                    style={[cameraStyles.videoShotJumpButton, { borderColor: resultColor }]}
                  >
                    <Text style={cameraStyles.videoShotJumpTitle}>{momentLabel}</Text>
                    <Text style={[cameraStyles.videoShotJumpMeta, { color: resultColor }]}>
                      {formatShotResult(event.result)} {formatShotTime(resultTime)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function StatCard({ label, value, color }) {
  return (
    <View style={cameraStyles.statCard}>
      <Text style={cameraStyles.statLabel}>{label}</Text>
      <Text style={[cameraStyles.statValue, { color }]}>{value}</Text>
    </View>
  );
}

const cameraStyles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  cameraStage: {
    minHeight: 280,
    backgroundColor: "#040b15",
    overflow: "hidden",
  },
  cameraFallback: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
    paddingBottom: 112,
    backgroundColor: colors.backgroundSoft,
  },
  cameraFallbackCardDown: {
    paddingBottom: 72,
  },
  cameraWarmupOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
    backgroundColor: "rgba(4, 11, 21, 0.72)",
  },
  fallbackTitle: {
    marginTop: 16,
    color: colors.text,
    fontSize: 24,
    fontWeight: "900",
  },
  fallbackText: {
    marginTop: 8,
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  permissionButton: {
    marginTop: 18,
    borderRadius: 999,
    backgroundColor: colors.primary,
    paddingHorizontal: 22,
    paddingVertical: 12,
  },
  permissionButtonText: {
    color: "#091220",
    fontWeight: "900",
  },
  topBar: {
    position: "absolute",
    top: 42,
    left: 16,
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  iconButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.cardElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  brandPill: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: colors.overlay,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  brandText: {
    color: colors.text,
    fontWeight: "900",
    fontSize: 15,
  },
  modeBadge: {
    position: "absolute",
    top: 100,
    left: 16,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: colors.overlay,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modeBadgeText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "900",
  },
  modeBadgeMeta: {
    marginTop: 2,
    color: colors.secondary,
    fontSize: 11,
    fontWeight: "800",
  },
  recordingPill: {
    position: "absolute",
    top: 100,
    right: 16,
    borderRadius: 999,
    backgroundColor: colors.danger,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  recordingText: {
    color: colors.text,
    fontWeight: "900",
    fontSize: 12,
  },
  countdownOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(4, 11, 21, 0.24)",
  },
  countdownNumber: {
    color: colors.text,
    fontSize: 82,
    fontWeight: "900",
  },
  countdownLabel: {
    marginTop: 4,
    color: colors.primary,
    fontSize: 14,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  modeMenu: {
    position: "absolute",
    left: 14,
    right: 14,
    borderRadius: 24,
    padding: 16,
    backgroundColor: colors.cardElevated,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  menuHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  menuBody: {
    flexShrink: 1,
  },
  menuBodyContent: {
    paddingBottom: 2,
  },
  menuCloseButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.backgroundSoft,
    borderWidth: 1,
    borderColor: colors.border,
  },
  menuEyebrow: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  menuTitle: {
    marginTop: 4,
    color: colors.text,
    fontSize: 20,
    fontWeight: "900",
  },
  overlayPill: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: colors.backgroundSoft,
    borderWidth: 1,
    borderColor: colors.border,
  },
  overlayPillActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  overlayPillText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "900",
  },
  overlayPillTextActive: {
    color: "#091220",
  },
  testRow: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 14,
  },
  testTitle: {
    color: colors.text,
    fontWeight: "900",
  },
  testCopy: {
    marginTop: 2,
    color: colors.muted,
    fontSize: 12,
  },
  menuToolRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 10,
  },
  menuToolButton: {
    flexGrow: 1,
    minWidth: 104,
    minHeight: 42,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.backgroundSoft,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  menuToolText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: "900",
  },
  menuGuideRow: {
    gap: 8,
    marginTop: 10,
  },
  menuGuideButton: {
    minHeight: 58,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.backgroundSoft,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  menuGuideButtonActive: {
    backgroundColor: "rgba(255, 122, 26, 0.16)",
    borderColor: colors.primary,
  },
  menuGuideIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 122, 26, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(255, 122, 26, 0.26)",
  },
  menuGuideIconActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  menuGuideButtonText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "900",
  },
  menuGuideHint: {
    marginTop: 3,
    color: colors.muted,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "800",
  },
  menuGuideButtonTextActive: {
    color: colors.text,
  },
  captureTray: {
    position: "absolute",
    left: 22,
    right: 22,
    bottom: 22,
    height: 82,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
  },
  captureSideSlot: {
    width: 64,
    alignItems: "center",
    justifyContent: "center",
  },
  captureSideButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.overlay,
    borderWidth: 1,
    borderColor: colors.border,
  },
  recordButton: {
    width: 82,
    height: 82,
    borderRadius: 41,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 5,
    borderColor: colors.text,
    backgroundColor: "rgba(247, 251, 255, 0.12)",
  },
  recordButtonActive: {
    borderColor: colors.danger,
  },
  recordButtonInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.danger,
  },
  recordButtonStop: {
    width: 32,
    height: 32,
    borderRadius: 8,
  },
  disabledControl: {
    opacity: 0.45,
  },
  appGuideOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 50,
    elevation: 50,
  },
  appGuideScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(3, 10, 22, 0.72)",
  },
  appGuideHighlight: {
    position: "absolute",
    borderRadius: 24,
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: "rgba(255, 122, 26, 0.10)",
    boxShadow: "0 0 24px rgba(255, 122, 26, 0.55)",
  },
  appGuidePanel: {
    position: "absolute",
    left: 16,
    right: 16,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.cardElevated,
    padding: 16,
  },
  appGuideStepText: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  appGuideTitle: {
    marginTop: 5,
    color: colors.text,
    fontSize: 20,
    fontWeight: "900",
  },
  appGuideBody: {
    marginTop: 8,
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "700",
  },
  appGuideActionRow: {
    marginTop: 15,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  appGuideSecondaryButton: {
    minHeight: 40,
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  appGuideSecondaryText: {
    color: colors.muted,
    fontWeight: "900",
  },
  appGuideNavButtons: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  appGuideSmallButton: {
    minHeight: 40,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.backgroundSoft,
  },
  appGuideSmallButtonText: {
    color: colors.text,
    fontWeight: "900",
  },
  appGuidePrimaryButton: {
    minHeight: 40,
    borderRadius: 999,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
  },
  appGuidePrimaryText: {
    color: "#091220",
    fontWeight: "900",
  },
  sessionSheet: {
    flex: 1,
    backgroundColor: colors.background,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    marginTop: -20,
    marginHorizontal: 8,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: colors.border,
    boxShadow: "0 -12px 28px rgba(0, 0, 0, 0.30)",
    overflow: "hidden",
  },
  sessionSheetCollapsed: {
    flex: 0,
  },
  sessionSheetExpanded: {
    marginHorizontal: 0,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
  },
  sessionSheetBody: {
    flex: 1,
  },
  sessionSheetContent: {
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 32,
  },
  sheetDragHeader: {
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 10,
  },
  sheetDragHeaderCollapsed: {
    paddingTop: 12,
    paddingBottom: 8,
  },
  sheetHandle: {
    alignSelf: "center",
    width: 56,
    height: 5,
    borderRadius: 999,
    backgroundColor: "rgba(247, 251, 255, 0.28)",
    marginBottom: 12,
  },
  sheetHandleCollapsed: {
    marginBottom: 10,
  },
  modeTrayHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingBottom: 8,
  },
  modeTrayHeaderCollapsed: {
    paddingBottom: 0,
  },
  sheetEyebrow: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  sheetTitle: {
    marginTop: 4,
    color: colors.text,
    fontSize: 24,
    fontWeight: "900",
  },
  sheetCopy: {
    marginTop: 6,
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
  },
  sheetCopyCollapsed: {
    marginTop: 4,
  },
  bottomModeGrid: {
    flexDirection: "row",
    gap: 8,
    paddingTop: 8,
    paddingBottom: 8,
  },
  bottomModeOption: {
    flex: 1,
    minHeight: 62,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.cardElevated,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  bottomModeOptionActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  bottomModeTag: {
    color: colors.secondary,
    fontSize: 9,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  bottomModeTitle: {
    marginTop: 4,
    color: colors.text,
    fontSize: 12,
    fontWeight: "900",
  },
  bottomModeTextActive: {
    color: "#091220",
  },
  bottomTrayLabel: {
    marginTop: 6,
    color: colors.primary,
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  bottomOutputRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 8,
    paddingBottom: 8,
  },
  sessionStatusRow: {
    paddingTop: 4,
  },
  clipPanel: {
    marginTop: 16,
    borderRadius: 18,
    padding: 14,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  clipLabel: {
    color: colors.text,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  clipValue: {
    marginTop: 6,
    color: colors.text,
    fontSize: 15,
    fontWeight: "900",
  },
  clipHelp: {
    marginTop: 6,
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
  },
  backendStatusRow: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  backendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  backendStatusText: {
    fontSize: 12,
    fontWeight: "800",
  },
  orientationPanel: {
    marginTop: 12,
    gap: 8,
  },
  orientationLabel: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  orientationChoiceRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  orientationPill: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.backgroundSoft,
    borderWidth: 1,
    borderColor: colors.border,
  },
  orientationPillActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  orientationPillText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: "900",
  },
  orientationPillTextActive: {
    color: "#091220",
  },
  orientationValue: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "900",
  },
  setupGuidePanel: {
    marginTop: 14,
    borderRadius: 16,
    padding: 13,
    backgroundColor: "rgba(255, 122, 26, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(255, 122, 26, 0.24)",
  },
  setupGuideHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  setupTipRow: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  setupTipDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    marginTop: 7,
    backgroundColor: colors.primary,
  },
  setupTipText: {
    flex: 1,
    color: colors.text,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "700",
  },
  poseReferenceCard: {
    marginTop: 12,
    borderRadius: 16,
    padding: 12,
    backgroundColor: "rgba(7, 17, 31, 0.34)",
    borderWidth: 1,
    borderColor: "rgba(255, 122, 26, 0.2)",
  },
  poseReferenceTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "900",
  },
  tutorialHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  tutorialIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 122, 26, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(255, 122, 26, 0.32)",
  },
  tutorialAttribution: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingTop: 9,
    paddingHorizontal: 2,
  },
  tutorialAttributionText: {
    color: colors.secondary,
    fontSize: 10,
    fontWeight: "800",
    textDecorationLine: "underline",
  },
  corePoseSequenceTitle: {
    marginTop: 14,
    color: colors.secondary,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  corePosePhaseRow: {
    marginTop: 9,
    padding: 10,
    borderRadius: 12,
    backgroundColor: "rgba(255, 255, 255, 0.035)",
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  corePosePhaseLabel: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "900",
  },
  corePosePhaseCue: {
    marginTop: 4,
    color: colors.muted,
    fontSize: 11,
    lineHeight: 16,
  },
  poseCueRow: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  poseCueDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    marginTop: 7,
    backgroundColor: colors.secondary,
  },
  poseCueText: {
    flex: 1,
    color: colors.text,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "700",
  },
  scoreReasonPanel: {
    marginTop: 16,
    borderRadius: 18,
    padding: 14,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  poseComparisonPanel: {
    marginTop: 16,
    borderRadius: 20,
    padding: 14,
    backgroundColor: "rgba(8, 18, 32, 0.96)",
    borderWidth: 1,
    borderColor: "rgba(61, 205, 255, 0.28)",
  },
  poseComparisonHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  poseComparisonIntro: {
    marginTop: 6,
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
  },
  measuredPill: {
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 6,
    backgroundColor: "rgba(61, 205, 255, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(61, 205, 255, 0.32)",
  },
  measuredPillText: {
    color: colors.secondary,
    fontSize: 9,
    fontWeight: "900",
  },
  poseComparisonGuideNote: {
    marginTop: 10,
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
  },
  poseMetricCard: {
    marginTop: 10,
    borderRadius: 14,
    padding: 12,
    backgroundColor: "rgba(255, 255, 255, 0.035)",
    borderWidth: 1,
    borderColor: colors.border,
  },
  poseMetricHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  poseMetricLabel: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
    fontWeight: "900",
  },
  poseMetricStatus: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  poseMetricStatusText: {
    fontSize: 9,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  poseMetricValues: {
    marginTop: 10,
    flexDirection: "row",
    gap: 8,
  },
  poseMetricValueColumn: {
    flex: 1,
  },
  poseMetricEyebrow: {
    color: colors.muted,
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  poseMetricValue: {
    marginTop: 4,
    color: colors.text,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "800",
  },
  poseMatchTrack: {
    height: 6,
    marginTop: 10,
    borderRadius: 999,
    overflow: "hidden",
    backgroundColor: colors.track,
  },
  poseMatchFill: {
    height: "100%",
    borderRadius: 999,
  },
  poseMetricFootnote: {
    marginTop: 7,
    color: colors.muted,
    fontSize: 10,
    lineHeight: 15,
  },
  poseComparisonDisclaimer: {
    marginTop: 12,
    color: colors.muted,
    fontSize: 10,
    lineHeight: 15,
    fontStyle: "italic",
  },
  scoreReasonIntro: {
    marginTop: 6,
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
  },
  scoreReasonRow: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  scoreReasonDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 6,
  },
  scoreReasonLabel: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "900",
  },
  scoreReasonText: {
    marginTop: 3,
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "700",
  },
  phaseScorePanel: {
    marginTop: 16,
    borderRadius: 20,
    padding: 14,
    backgroundColor: "rgba(8, 18, 32, 0.96)",
    borderWidth: 1,
    borderColor: "rgba(255, 122, 26, 0.28)",
  },
  phaseScoreIntro: {
    marginTop: 6,
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
  },
  phaseScoreGrid: {
    marginTop: 12,
    gap: 10,
  },
  phaseScoreCard: {
    borderRadius: 14,
    borderWidth: 1,
    backgroundColor: colors.cardElevated,
    padding: 12,
  },
  phaseScoreHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
  },
  phaseScoreLabel: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
    fontWeight: "900",
  },
  phaseScoreStatus: {
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  phaseScoreTrack: {
    height: 7,
    marginTop: 10,
    borderRadius: 999,
    overflow: "hidden",
    backgroundColor: colors.track,
  },
  phaseScoreFill: {
    height: "100%",
    borderRadius: 999,
  },
  phaseScoreValue: {
    marginTop: 7,
    color: colors.text,
    fontSize: 12,
    fontWeight: "900",
  },
  phaseScoreCue: {
    marginTop: 5,
    color: colors.muted,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "700",
  },
  coachReviewPanel: {
    marginTop: 16,
    borderRadius: 18,
    padding: 14,
    backgroundColor: colors.cardElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  reviewHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  reviewTitle: {
    marginTop: 4,
    color: colors.text,
    fontSize: 18,
    fontWeight: "900",
  },
  trackingPill: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: "rgba(7, 17, 31, 0.34)",
  },
  trackingPillText: {
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  reviewLevelSelector: {
    marginTop: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    flexDirection: "row",
    padding: 4,
    gap: 4,
  },
  reviewLevelButton: {
    flex: 1,
    minHeight: 36,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  reviewLevelButtonActive: {
    backgroundColor: colors.primary,
  },
  reviewLevelText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "900",
  },
  reviewLevelTextActive: {
    color: "#091220",
  },
  reviewMainText: {
    marginTop: 10,
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "800",
  },
  trackingWarning: {
    marginTop: 10,
    borderRadius: 14,
    borderWidth: 1,
    backgroundColor: "rgba(255, 209, 102, 0.1)",
    padding: 10,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  trackingWarningText: {
    flex: 1,
    color: colors.text,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "800",
  },
  reviewInfoRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 12,
  },
  reviewInfoItem: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 12,
  },
  reviewInfoLabel: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  reviewInfoValue: {
    marginTop: 5,
    color: colors.text,
    fontSize: 20,
    fontWeight: "900",
  },
  reviewInfoHelp: {
    marginTop: 4,
    color: colors.muted,
    fontSize: 11,
    lineHeight: 16,
  },
  reviewCoachText: {
    marginTop: 12,
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
  },
  shotReviewPanel: {
    marginTop: 16,
    borderRadius: 18,
    padding: 14,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  shotReviewIntro: {
    marginTop: 6,
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
  },
  shotReviewGrid: {
    marginTop: 12,
    gap: 10,
  },
  shotReviewCard: {
    borderRadius: 14,
    borderWidth: 1,
    backgroundColor: colors.cardElevated,
    padding: 12,
  },
  shotReviewHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  shotReviewTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "900",
  },
  shotReviewResult: {
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  shotReviewTime: {
    marginTop: 4,
    color: colors.muted,
    fontSize: 11,
    fontWeight: "800",
  },
  shotReviewMetaRow: {
    marginTop: 8,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  shotReviewMetaPill: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.backgroundSoft,
    paddingHorizontal: 9,
    paddingVertical: 5,
    color: colors.muted,
    fontSize: 10,
    fontWeight: "900",
  },
  shotReviewText: {
    marginTop: 8,
    color: colors.text,
    fontSize: 12,
    lineHeight: 18,
  },
  shotReviewReason: {
    marginTop: 6,
    color: colors.secondary,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "800",
  },
  shotEvidenceList: {
    marginTop: 8,
    gap: 6,
  },
  shotEvidenceRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 7,
  },
  shotEvidenceDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    marginTop: 6,
    backgroundColor: colors.secondary,
  },
  shotEvidenceText: {
    flex: 1,
    color: colors.muted,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "700",
  },
  modeReviewPanel: {
    marginTop: 16,
    borderRadius: 18,
    padding: 14,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modeReviewHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  modeReviewIntro: {
    marginTop: 6,
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
  },
  modeActionCount: {
    minWidth: 92,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.cardElevated,
    padding: 10,
    alignItems: "center",
  },
  modeActionValue: {
    color: colors.primary,
    fontSize: 24,
    fontWeight: "900",
  },
  modeActionLabel: {
    marginTop: 3,
    color: colors.muted,
    fontSize: 9,
    lineHeight: 13,
    textAlign: "center",
    fontWeight: "900",
    textTransform: "uppercase",
  },
  modeReviewGrid: {
    marginTop: 12,
    gap: 10,
  },
  modeReviewCard: {
    borderRadius: 14,
    borderWidth: 1,
    backgroundColor: colors.cardElevated,
    padding: 12,
  },
  modeReviewLabel: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "900",
  },
  modeReviewStatus: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  modeReviewTip: {
    marginTop: 8,
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
  },
  modeMomentGrid: {
    marginTop: 12,
    gap: 10,
  },
  modeMomentCard: {
    borderRadius: 14,
    borderWidth: 1,
    backgroundColor: colors.backgroundSoft,
    padding: 12,
  },
  modeMomentLabel: {
    color: colors.primary,
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  modeMomentTitle: {
    marginTop: 4,
    color: colors.text,
    fontSize: 13,
    fontWeight: "900",
  },
  modeMomentTime: {
    marginTop: 3,
    color: colors.muted,
    fontSize: 11,
    fontWeight: "800",
  },
  modeMomentText: {
    marginTop: 7,
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
  },
  modeReviewCue: {
    marginTop: 12,
    color: colors.text,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "800",
  },
  sheetActionRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 12,
  },
  sheetSecondaryAction: {
    flex: 1,
    minHeight: 48,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.cardElevated,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 12,
  },
  sheetSecondaryActionText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "900",
  },
  sheetPrimaryAction: {
    flex: 1,
    minHeight: 48,
    borderRadius: 999,
    backgroundColor: colors.primary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 12,
  },
  sheetPrimaryActionText: {
    color: "#091220",
    fontSize: 13,
    fontWeight: "900",
  },
  progressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 16,
  },
  progressLabel: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "900",
  },
  progressTrack: {
    flex: 1,
    height: 8,
    borderRadius: 999,
    backgroundColor: colors.track,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: colors.primary,
  },
  uploadProgressFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: colors.secondary,
  },
  progressNumber: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "900",
  },
  controlRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 12,
  },
  cancelButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.danger,
    backgroundColor: "rgba(255, 123, 123, 0.14)",
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelButtonText: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: "900",
  },
  retryButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 999,
    backgroundColor: colors.primary,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  retryButtonText: {
    color: "#091220",
    fontSize: 13,
    fontWeight: "900",
  },
  statCard: {
    flex: 1,
    minHeight: 88,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.cardElevated,
    padding: 13,
  },
  statLabel: {
    fontSize: 9,
    color: colors.muted,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  statValue: {
    marginTop: 8,
    fontSize: 18,
    fontWeight: "900",
  },
  focusPanel: {
    marginTop: 14,
    borderRadius: 18,
    padding: 14,
    backgroundColor: "rgba(255, 209, 102, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(255, 209, 102, 0.24)",
  },
  explanationPanel: {
    marginTop: 14,
    borderRadius: 18,
    padding: 14,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  explanationRow: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  explanationLabel: {
    width: 72,
    color: colors.muted,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  explanationValue: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
  },
  focusText: {
    marginTop: 8,
    color: colors.text,
    fontSize: 13,
    lineHeight: 18,
  },
  summaryText: {
    marginTop: 14,
    color: colors.text,
    fontSize: 13,
    lineHeight: 19,
  },
  errorText: {
    marginTop: 12,
    color: colors.danger,
    fontSize: 13,
    lineHeight: 18,
  },
  archiveText: {
    marginTop: 12,
    fontSize: 13,
    lineHeight: 18,
  },
  resultVideoFrame: {
    marginTop: 16,
    overflow: "hidden",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#040b15",
  },
  videoShotJumpPanel: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  videoShotJumpRow: {
    marginTop: 10,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  videoShotJumpButton: {
    minWidth: 102,
    borderRadius: 14,
    borderWidth: 1,
    backgroundColor: "rgba(7, 17, 31, 0.36)",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  videoShotJumpTitle: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "900",
  },
  videoShotJumpMeta: {
    marginTop: 3,
    fontSize: 11,
    fontWeight: "800",
  },
});
