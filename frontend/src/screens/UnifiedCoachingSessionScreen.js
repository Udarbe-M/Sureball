import { useEvent } from "expo";
import { Feather } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as DocumentPicker from "expo-document-picker";
import { VideoView, useVideoPlayer } from "expo-video";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Linking, PanResponder, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from "react-native";
import PrimaryButton from "../components/PrimaryButton";
import { useAuth } from "../context/AuthContext";
import {
  buildCoachingVideoDownloadUrl,
  cancelCoachingVideoAnalysis,
  fetchCoachingVideoStatus,
  healthCheck,
  startCoachingVideoAnalysis,
} from "../services/api";
import { Haptics, hapticImpact, hapticSelection, hapticSuccess, hapticWarning } from "../services/haptics";
import { archiveCompletedSession } from "../services/sessionArchive";
import { colors } from "../theme/colors";
import { buildUserKey } from "../utils/userKey";

const MODES = [
  {
    id: "shooting_form",
    title: "Shooting",
    tag: "Shot",
    description: "Review elbow line, knee load, ball release, and balance.",
  },
  {
    id: "dribbling",
    title: "Dribbling",
    tag: "Handle",
    description: "Track low handle control, ball-to-hand connection, stance, and balance.",
  },
  {
    id: "passing",
    title: "Passing",
    tag: "Pass",
    description: "Check passing line, hand-to-ball connection, release window, and body control.",
  },
];

const COACHING_OVERLAY_OPTIONS = [
  {
    id: "full_overlay",
    title: "Full Overlay",
    description: "Show pose landmarks, ball tracking, score, and feedback on the analyzed video.",
  },
  {
    id: "focus_feedback",
    title: "Focus",
    description: "Prioritize coaching cues and score panels with a cleaner presentation.",
  },
  {
    id: "score_only",
    title: "Score",
    description: "Keep the output clean with the scoreboard and footer only.",
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
  classification: "",
  summary: "",
  dominantFeedback: [],
};

function clampPercent(value) {
  const numericValue = Number(value || 0);
  if (!Number.isFinite(numericValue)) {
    return 0;
  }
  return Math.max(0, Math.min(Math.round(numericValue), 100));
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
    { label: "Main cue", value: topCue },
  ];
}

export default function UnifiedCoachingSessionScreen({ route, navigation }) {
  const initialModeId = route.params?.initialModeId || "shooting_form";
  const { playerEmail, playerName, userId } = useAuth();
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [overlayMode, setOverlayMode] = useState("focus_feedback");
  const [recordingStatus, setRecordingStatus] = useState("Frame the player, then record or upload a clip.");
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const cameraRef = useRef(null);
  const uploadAbortRef = useRef(null);
  const cameraReadyTimerRef = useRef(null);

  const userKey = useMemo(
    () => buildUserKey({ userId, playerName, playerEmail }),
    [playerEmail, playerName, userId]
  );
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

  const resultVideoUrl = useMemo(() => {
    if (!jobId || status !== "completed") {
      return null;
    }
    return buildCoachingVideoDownloadUrl(jobId);
  }, [jobId, status]);

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

  useEffect(() => {
    const nextModeId = route.params?.initialModeId || "shooting_form";
    const nextMode = MODES.find((item) => item.id === nextModeId) || MODES[0];
    setSelectedModeId(nextMode.id);
    clearCameraReadyTimer();
    setCameraOpen(false);
    setCameraStarting(false);
    setCameraTrouble(false);
    setRecording(false);
    setMenuOpen(false);
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
          classification: result.classification || "",
          summary: result.summary || "",
          dominantFeedback: result.dominant_feedback || [],
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
    if (!cameraRef.current || recording) {
      return;
    }

    setErrorMessage("");
    hapticImpact(Haptics.ImpactFeedbackStyle.Medium);
    setRecording(true);
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

  async function toggleCameraPower() {
    if (recording) {
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
  const recordButtonDisabled =
    busyWithAnalysis ||
    (cameraOpen && !cameraPermission?.granted) ||
    cameraStarting ||
    cameraTrouble ||
    recordingStatus === "Finishing clip...";
  const recordButtonAction = recording ? stopRecordingClip : cameraOpen ? startRecordingClip : openCameraRecorder;
  const statusLabel = status === "idle" ? "Ready" : status.replace(/_/g, " ");

  return (
    <View style={cameraStyles.screen}>
      <View style={cameraStyles.cameraStage} {...modeSwipeResponder.panHandlers}>
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
              facing="back"
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
          <View style={cameraStyles.cameraFallback}>
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
          <TouchableOpacity activeOpacity={0.9} onPress={() => setMenuOpen((current) => !current)} style={cameraStyles.iconButton}>
            <Feather name={menuOpen ? "x" : "menu"} size={23} color={colors.text} />
          </TouchableOpacity>
          <View style={cameraStyles.brandPill}>
            <Text style={cameraStyles.brandText}>SureBall</Text>
          </View>
          <TouchableOpacity activeOpacity={0.9} onPress={() => navigation.navigate("PlayerMenu")} style={cameraStyles.iconButton}>
            <Feather name="user" size={21} color={colors.text} />
          </TouchableOpacity>
        </View>

        <View style={cameraStyles.modeBadge}>
          <Text style={cameraStyles.modeBadgeText}>{activeMode.title}</Text>
          <Text style={cameraStyles.modeBadgeMeta}>{selectedOverlay?.title}</Text>
        </View>

        <View style={cameraStyles.rightRail}>
          <CameraIconButton icon="clock" onPress={() => navigation.navigate("SessionHistory")} />
          <CameraIconButton icon="settings" onPress={() => navigation.navigate("Settings")} />
          <CameraIconButton
            icon={cameraPowered ? "camera" : "camera-off"}
            onPress={toggleCameraPower}
            disabled={recording}
            active={cameraPowered}
            badge={cameraPowered ? "ON" : "OFF"}
            accessibilityLabel={cameraToggleLabel}
          />
        </View>

        {recording ? (
          <View style={cameraStyles.recordingPill}>
            <Text style={cameraStyles.recordingText}>REC</Text>
          </View>
        ) : null}

        {menuOpen ? (
          <View style={cameraStyles.modeMenu}>
            <Text style={cameraStyles.menuEyebrow}>Coaching Mode</Text>
            <Text style={cameraStyles.menuTitle}>Pick a drill</Text>
            <View style={cameraStyles.modeGrid}>
              {MODES.map((mode) => (
                <TouchableOpacity
                  key={mode.id}
                  activeOpacity={0.9}
                  onPress={() => handleModeChange(mode.id)}
                  disabled={busyWithAnalysis || recording}
                  style={[cameraStyles.modeOption, selectedModeId === mode.id && cameraStyles.modeOptionActive]}
                >
                  <Text style={cameraStyles.modeOptionTag}>{mode.tag}</Text>
                  <Text style={cameraStyles.modeOptionTitle}>{mode.title}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[cameraStyles.menuEyebrow, { marginTop: 16 }]}>Output</Text>
            <View style={cameraStyles.overlayRow}>
              {COACHING_OVERLAY_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option.id}
                  activeOpacity={0.9}
                  onPress={() => setOverlayMode(option.id)}
                  disabled={busyWithAnalysis}
                  style={[cameraStyles.overlayPill, option.id === overlayMode && cameraStyles.overlayPillActive]}
                >
                  <Text style={[cameraStyles.overlayPillText, option.id === overlayMode && cameraStyles.overlayPillTextActive]}>
                    {option.title}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

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
          </View>
        ) : null}

        {!menuOpen ? (
          <View style={cameraStyles.modeStrip}>
            {MODES.map((mode) => {
              const active = selectedModeId === mode.id;
              return (
                <TouchableOpacity
                  key={mode.id}
                  activeOpacity={0.9}
                  onPress={() => handleModeChange(mode.id)}
                  disabled={status === "processing" || starting || recording}
                  style={[cameraStyles.modeChip, active && cameraStyles.modeChipActive]}
                >
                  <Text style={[cameraStyles.modeChipText, active && cameraStyles.modeChipTextActive]}>{mode.title}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ) : null}

        <View style={cameraStyles.captureTray}>
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={pickVideo}
            disabled={busyWithAnalysis || recording}
            style={[cameraStyles.trayButton, (busyWithAnalysis || recording) && cameraStyles.disabledControl]}
          >
            <Feather name="upload" size={21} color={colors.text} />
          </TouchableOpacity>

          <TouchableOpacity
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

          <TouchableOpacity
            activeOpacity={0.9}
            onPress={handleStartSession}
            disabled={!selectedVideo || busyWithAnalysis || recording || backendUnavailable}
            style={[
              cameraStyles.analyzeButton,
              (!selectedVideo || busyWithAnalysis || recording || backendUnavailable) && cameraStyles.disabledControl,
            ]}
          >
            <Feather name="activity" size={18} color="#091220" />
            <Text style={cameraStyles.analyzeButtonText}>{busyWithAnalysis ? "Busy" : "Analyze"}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView style={cameraStyles.sessionSheet} contentContainerStyle={cameraStyles.sessionSheetContent}>
        <View style={cameraStyles.sheetHandle} />
        <View style={cameraStyles.sessionHeaderRow}>
          <View style={{ flex: 1 }}>
            <Text style={cameraStyles.sheetEyebrow}>{playerName}</Text>
            <Text style={cameraStyles.sheetTitle}>{activeMode.title}</Text>
            <Text style={cameraStyles.sheetCopy}>{recordingStatus}</Text>
          </View>
          <View style={cameraStyles.statusChip}>
            <Text style={cameraStyles.statusChipText}>{statusLabel}</Text>
          </View>
        </View>

        <View style={cameraStyles.clipPanel}>
          <Text style={cameraStyles.clipLabel}>Clip</Text>
          <Text style={cameraStyles.clipValue}>{selectedVideoLabel}</Text>
          <Text style={cameraStyles.clipHelp}>
            Record or upload a clip. The backend analyzes it with YOLOv11 basketball detection and MediaPipe pose tracking.
          </Text>
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

        <View style={cameraStyles.progressRow}>
          <Text style={cameraStyles.progressLabel}>Progress</Text>
          <View style={cameraStyles.progressTrack}>
            <View style={[cameraStyles.progressFill, { width: `${displayedProgress}%` }]} />
          </View>
          <Text style={cameraStyles.progressNumber}>{displayedProgress}%</Text>
        </View>

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
          <View style={cameraStyles.explanationPanel}>
            <Text style={cameraStyles.clipLabel}>Why This Score</Text>
            {scoreExplanation.map((item) => (
              <View key={item.label} style={cameraStyles.explanationRow}>
                <Text style={cameraStyles.explanationLabel}>{item.label}</Text>
                <Text style={cameraStyles.explanationValue}>{item.value}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {coachingResults.dominantFeedback.length > 0 ? (
          <View style={cameraStyles.focusPanel}>
            <Text style={cameraStyles.clipLabel}>Top Focus Areas</Text>
            {coachingResults.dominantFeedback.map((item, index) => (
              <Text key={`${item}-${index}`} style={cameraStyles.focusText}>
                {item}
              </Text>
            ))}
          </View>
        ) : null}

        {coachingResults.summary ? <Text style={cameraStyles.summaryText}>{coachingResults.summary}</Text> : null}
        {errorMessage ? <Text style={cameraStyles.errorText}>{errorMessage}</Text> : null}
        {archiveMessage ? (
          <Text style={[cameraStyles.archiveText, archiveMessageTone === "success" ? { color: colors.success } : { color: colors.warning }]}>
            {archiveMessage}
          </Text>
        ) : null}

        {resultVideoUrl ? (
          <>
            <View style={cameraStyles.resultVideoFrame}>
              <ResultVideoPlayer videoUrl={resultVideoUrl} />
            </View>
            <PrimaryButton title="Download Video" onPress={openResultVideo} />
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function CameraIconButton({ icon, onPress, disabled = false, active = false, badge, accessibilityLabel }) {
  return (
    <TouchableOpacity
      activeOpacity={0.9}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      disabled={disabled}
      style={[cameraStyles.railButton, active && cameraStyles.railButtonActive, disabled && cameraStyles.disabledControl]}
    >
      <Feather name={icon} size={21} color={active ? "#091220" : colors.text} />
      {badge ? <Text style={[cameraStyles.railBadge, active && cameraStyles.railBadgeActive]}>{badge}</Text> : null}
    </TouchableOpacity>
  );
}

function ResultVideoPlayer({ videoUrl }) {
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

  return (
    <View>
      <VideoView
        style={{ width: "100%", height: 320, backgroundColor: "#040b15" }}
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
    height: "62%",
    minHeight: 460,
    backgroundColor: "#040b15",
    overflow: "hidden",
  },
  cameraFallback: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
    backgroundColor: colors.backgroundSoft,
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
    paddingHorizontal: 18,
    paddingVertical: 10,
    backgroundColor: colors.overlay,
    borderWidth: 1,
    borderColor: colors.border,
  },
  brandText: {
    color: colors.text,
    fontWeight: "900",
    fontSize: 16,
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
  rightRail: {
    position: "absolute",
    top: 158,
    right: 16,
    gap: 12,
  },
  railButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.overlay,
    borderWidth: 1,
    borderColor: colors.border,
  },
  railButtonActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  railBadge: {
    marginTop: 1,
    color: colors.muted,
    fontSize: 8,
    fontWeight: "900",
  },
  railBadgeActive: {
    color: "#091220",
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
  modeMenu: {
    position: "absolute",
    left: 14,
    right: 14,
    bottom: 118,
    borderRadius: 24,
    padding: 16,
    backgroundColor: colors.cardElevated,
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
  modeGrid: {
    flexDirection: "row",
    gap: 10,
    marginTop: 12,
  },
  modeOption: {
    flex: 1,
    minHeight: 82,
    borderRadius: 18,
    padding: 12,
    justifyContent: "space-between",
    backgroundColor: colors.backgroundSoft,
    borderWidth: 2,
    borderColor: colors.border,
  },
  modeOptionActive: {
    backgroundColor: "rgba(255, 122, 26, 0.14)",
    borderColor: colors.primary,
  },
  modeOptionTag: {
    color: colors.secondary,
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  modeOptionTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "900",
  },
  overlayRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 10,
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
  modeStrip: {
    position: "absolute",
    left: 14,
    right: 14,
    bottom: 116,
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
  },
  modeChip: {
    minWidth: 92,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.overlay,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: "center",
  },
  modeChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  modeChipText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: "900",
  },
  modeChipTextActive: {
    color: "#091220",
  },
  captureTray: {
    position: "absolute",
    left: 22,
    right: 22,
    bottom: 22,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  trayButton: {
    width: 54,
    height: 54,
    borderRadius: 27,
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
  analyzeButton: {
    minWidth: 96,
    height: 54,
    borderRadius: 27,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 7,
    backgroundColor: colors.primary,
    paddingHorizontal: 14,
  },
  analyzeButtonText: {
    color: "#091220",
    fontSize: 13,
    fontWeight: "900",
  },
  disabledControl: {
    opacity: 0.45,
  },
  sessionSheet: {
    flex: 1,
    backgroundColor: colors.background,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    marginTop: -18,
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  sessionSheetContent: {
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 32,
  },
  sheetHandle: {
    alignSelf: "center",
    width: 42,
    height: 5,
    borderRadius: 999,
    backgroundColor: colors.border,
    marginBottom: 14,
  },
  sessionHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
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
  statusChip: {
    borderRadius: 999,
    backgroundColor: "rgba(255, 122, 26, 0.14)",
    borderWidth: 1,
    borderColor: "rgba(255, 122, 26, 0.34)",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  statusChipText: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
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
});
