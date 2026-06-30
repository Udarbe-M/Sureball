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
import { Linking, ScrollView, Switch, Text, TouchableOpacity, useWindowDimensions, View } from "react-native";
import PrimaryButton from "../components/PrimaryButton";
import { useAuth } from "../context/AuthContext";
import {
  buildShootingTrainingDownloadUrl,
  cancelShootingTraining,
  fetchShootingTrainingStatus,
  startShootingTraining,
} from "../services/api";
import { Haptics, hapticImpact, hapticSelection, hapticSuccess, hapticWarning } from "../services/haptics";
import { archiveCompletedSession } from "../services/sessionArchive";
import {
  getRecordingCountdownSecondsPreference,
  getRecordingCountdownSoundPreference,
} from "../services/storage";
import { commonStyles } from "../theme/styles";
import { colors } from "../theme/colors";
import { COUNTDOWN_BEEP_SOURCE, COUNTDOWN_START_BUZZER_SOURCE, wait } from "../utils/countdown";
import { buildCoachingSpeech } from "../utils/coachingSpeech";
import { buildUserKey } from "../utils/userKey";

const OVERLAY_OPTIONS = [
  {
    id: "full_tracking",
    title: "Full Overlay",
    description: "Show tracking details, detection boxes, shot stats, and result banners.",
  },
  {
    id: "focus_stats",
    title: "Focus",
    description: "Show shot stats and make banners without detection boxes.",
  },
  {
    id: "stats_only",
    title: "Score",
    description: "Only show attempts, makes, misses, and accuracy.",
  },
];

const SOURCE_ORIENTATION_OPTIONS = [
  { id: "auto", title: "Auto" },
  { id: "portrait", title: "Portrait" },
  { id: "landscape", title: "Landscape" },
];

const INITIAL_STATS = {
  attempts: 0,
  makes: 0,
  misses: 0,
  accuracy: 0,
};

export default function ShootingTrainingScreen({ navigation }) {
  const { playerEmail, playerName, userId } = useAuth();
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const landscapeViewport = viewportWidth > viewportHeight;
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [videoSource, setVideoSource] = useState("upload");
  const [overlayMode, setOverlayMode] = useState("focus_stats");
  const [testMode, setTestMode] = useState(false);
  const [jobId, setJobId] = useState(null);
  const [status, setStatus] = useState("idle");
  const [progress, setProgress] = useState(0);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [stats, setStats] = useState(INITIAL_STATS);
  const [summary, setSummary] = useState("");
  const [classification, setClassification] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [archiveMessage, setArchiveMessage] = useState("");
  const [archiveMessageTone, setArchiveMessageTone] = useState("neutral");
  const [starting, setStarting] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraViewKey, setCameraViewKey] = useState(0);
  const [cameraFacing, setCameraFacing] = useState("back");
  const [recording, setRecording] = useState(false);
  const [countdownValue, setCountdownValue] = useState(null);
  const [recordingCountdownSeconds, setRecordingCountdownSeconds] = useState(3);
  const [recordingCountdownSound, setRecordingCountdownSound] = useState(true);
  const [sourceOrientation, setSourceOrientation] = useState("auto");
  const [outputDimensions, setOutputDimensions] = useState({ width: 0, height: 0 });
  const [recordingStatus, setRecordingStatus] = useState("Ready to record a new clip.");
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const cameraRef = useRef(null);
  const countdownCancelRef = useRef(false);
  const uploadAbortRef = useRef(null);
  const countdownPlayer = useAudioPlayer(COUNTDOWN_BEEP_SOURCE);
  const countdownStartPlayer = useAudioPlayer(COUNTDOWN_START_BUZZER_SOURCE);
  const userKey = useMemo(
    () => buildUserKey({ userId, playerName, playerEmail }),
    [playerEmail, playerName, userId]
  );

  const refreshCountdownPreferences = useCallback(async () => {
    const [seconds, soundEnabled] = await Promise.all([
      getRecordingCountdownSecondsPreference(userKey),
      getRecordingCountdownSoundPreference(userKey),
    ]);
    setRecordingCountdownSeconds(seconds);
    setRecordingCountdownSound(soundEnabled);
  }, [userKey]);

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
    if (!jobId || status !== "processing") {
      return undefined;
    }

    const timer = setInterval(async () => {
      try {
        const result = await fetchShootingTrainingStatus(jobId);
        setProgress(clampPercent(result.progress_percentage));
        setStats(result.stats || INITIAL_STATS);
        setSummary(result.summary || "");
        setClassification(result.classification || "");
        setOutputDimensions({ width: result.output_width || 0, height: result.output_height || 0 });

        if (result.status === "completed") {
          const archivedAt = new Date().toISOString();
          const remoteVideoUrl = buildShootingTrainingDownloadUrl(jobId);
          const archiveResult = await archiveCompletedSession({
            userKey,
            remoteVideoUrl,
            videoSaveOptions: {
              sessionId: jobId,
              mode: "shooting_training",
              timestamp: archivedAt,
              suffix: "shot-lab",
            },
            record: {
              id: jobId,
              userKey,
              playerName,
              playerEmail,
              mode: "shooting_training",
              modeLabel: "Shooting Training",
              score: Number(result.stats?.accuracy || 0),
              actionCount: result.stats?.attempts || 0,
              actionLabel: "Shots",
              shootingStats: result.stats || INITIAL_STATS,
              shotEvents: result.shot_events || [],
              classification: result.classification || "Needs Improvement",
              detectedErrors: [],
              timestamp: archivedAt,
              summary: result.summary || "",
            },
            messages: {
              success: "Annotated video saved on this phone for offline playback in Session History.",
              disabled: "Training finished. Automatic video saving is turned off in Settings.",
              failurePrefix: "Training finished, but the offline video copy could not be saved",
            },
          });
          setArchiveMessageTone(archiveResult.archiveMessageTone);
          setArchiveMessage(archiveResult.archiveMessage);
          setStatus("completed");
          hapticSuccess();
        } else if (result.status === "cancelled") {
          setStatus("cancelled");
          setErrorMessage("Training analysis cancelled.");
          hapticWarning();
        } else if (result.status === "error") {
          setStatus("error");
          setErrorMessage(result.error_message || "Shot training failed.");
          hapticWarning();
        }
      } catch (error) {
        setStatus("error");
        setErrorMessage(String(error.message || error));
        hapticWarning();
      }
    }, 1500);

    return () => clearInterval(timer);
  }, [jobId, playerEmail, playerName, status, userKey]);

  useEffect(() => {
    return () => {
      countdownCancelRef.current = true;
      if (cameraRef.current && recording) {
        cameraRef.current.stopRecording();
      }
    };
  }, [recording]);

  const selectedOverlay = useMemo(
    () => OVERLAY_OPTIONS.find((item) => item.id === overlayMode),
    [overlayMode]
  );
  const resultVideoUrl = useMemo(() => {
    if (!jobId || status !== "completed") {
      return null;
    }
    return buildShootingTrainingDownloadUrl(jobId);
  }, [jobId, status]);
  const coachingSpeechText = useMemo(
    () =>
      buildCoachingSpeech({
        modeLabel: "shooting training",
        score: stats.accuracy,
        classification,
        summary,
        stats,
      }),
    [classification, stats, summary]
  );

  const selectedVideoLabel = useMemo(() => {
    if (!selectedVideo) {
      return "No clip selected yet.";
    }
    return selectedVideo.name || (videoSource === "camera" ? "Recorded training clip" : "Chosen training clip");
  }, [selectedVideo, videoSource]);

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
    setCameraOpen(false);
    resetRunState();
  }

  async function openCameraRecorder() {
    hapticSelection();
    if (!cameraPermission?.granted) {
      const permissionResult = await requestCameraPermission();
      if (!permissionResult.granted) {
        setErrorMessage("Camera permission is required to record a training clip.");
        return;
      }
    }

    setVideoSource("camera");
    setCameraOpen(true);
    setCameraViewKey((current) => current + 1);
    setRecordingStatus("Frame the shooter and rim, then start recording.");
    setErrorMessage("");
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
          name: `live-shot-training-${Date.now()}.mp4`,
          mimeType: "video/mp4",
        });
        setSourceOrientation(recordingSourceOrientation);
        setRecordingStatus("Recorded clip ready for analysis.");
        setCameraOpen(false);
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

  function closeCameraRecorder() {
    if (recording && cameraRef.current) {
      cameraRef.current.stopRecording();
    }
    countdownCancelRef.current = true;
    setCountdownValue(null);
    setRecording(false);
    setCameraOpen(false);
    setRecordingStatus("Ready to record a new clip.");
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

  async function handleStartTraining() {
    if (!selectedVideo) {
      return;
    }

    setStarting(true);
    setStatus("starting");
    setErrorMessage("");
    setArchiveMessage("");
    setArchiveMessageTone("neutral");
    setSummary("");
    setClassification("");
    setStats(INITIAL_STATS);
    setOutputDimensions({ width: 0, height: 0 });
    setProgress(0);
    setUploadProgress(0);

    try {
      hapticImpact(Haptics.ImpactFeedbackStyle.Medium);
      const abortController = new AbortController();
      uploadAbortRef.current = abortController;
      setStatus("uploading");
      const result = await startShootingTraining({
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

  async function handleCancelTraining() {
    if (uploadAbortRef.current) {
      uploadAbortRef.current.abort();
      return;
    }
    if (status === "processing" && jobId) {
      try {
        await cancelShootingTraining(jobId);
        setStatus("cancelled");
        setErrorMessage("Training analysis cancelled.");
      } catch (error) {
        setStatus("error");
        setErrorMessage(String(error.message || error));
      }
      hapticWarning();
    }
  }

  async function openResultVideo() {
    if (!jobId) {
      return;
    }
    await Linking.openURL(buildShootingTrainingDownloadUrl(jobId));
  }

  function resetRunState() {
    setJobId(null);
    setStatus("idle");
    setProgress(0);
    setStats(INITIAL_STATS);
    setSummary("");
    setClassification("");
    setErrorMessage("");
    setArchiveMessage("");
    setArchiveMessageTone("neutral");
    setUploadProgress(0);
    setOutputDimensions({ width: 0, height: 0 });
  }

  const busyWithAnalysis = status === "processing" || status === "uploading" || starting;
  const countdownActive = countdownValue !== null;
  const sourceOrientationLabel =
    sourceOrientation === "landscape" ? "Landscape" : sourceOrientation === "portrait" ? "Portrait" : "Auto";

  return (
    <ScrollView style={commonStyles.screen} contentContainerStyle={commonStyles.screenBottomSpace}>
      <View style={commonStyles.heroCard}>
        <Text style={commonStyles.eyebrow}>Shot Lab</Text>
        <Text style={[commonStyles.title, { marginTop: 10 }]}>Shooting Training</Text>
        <Text style={commonStyles.subtitle}>
          Choose a saved video or record a fresh courtside clip. SureBall will estimate attempts, makes, misses,
          and overall accuracy.
        </Text>
      </View>

      <View style={commonStyles.card}>
        <Text style={commonStyles.label}>Clip Source</Text>
        <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
          <SourceButton
            active={videoSource === "upload"}
            title="Choose Video"
            description="Pick a saved training clip"
            onPress={pickVideo}
            disabled={busyWithAnalysis || recording}
          />
          <SourceButton
            active={videoSource === "camera"}
            title="Record Live"
            description="Capture from the camera now"
            onPress={openCameraRecorder}
            disabled={busyWithAnalysis}
          />
        </View>
        <Text style={[commonStyles.subtitle, { marginTop: 14, color: colors.text }]}>Selected: {selectedVideoLabel}</Text>
        <Text style={[commonStyles.subtitle, { fontSize: 12 }]}>
          Tip: side-angle or baseline clips work best when the entire shot path and rim stay in frame.
        </Text>
        <View style={{ marginTop: 14 }}>
          <Text style={commonStyles.label}>Clip Orientation</Text>
          {videoSource === "upload" ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
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
                    style={{
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: active ? colors.primary : colors.border,
                      backgroundColor: active ? colors.primary : colors.backgroundSoft,
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                    }}
                  >
                    <Text style={{ color: active ? "#091220" : colors.text, fontSize: 12, fontWeight: "900" }}>
                      {option.title}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : (
            <Text style={[commonStyles.subtitle, { marginTop: 8, color: colors.text }]}>{sourceOrientationLabel}</Text>
          )}
        </View>
      </View>

      {cameraOpen ? (
        <View style={commonStyles.card}>
          <Text style={commonStyles.label}>Live Camera Recorder</Text>
          <Text style={commonStyles.subtitle}>{recordingStatus}</Text>
          {cameraPermission?.granted ? (
            <View style={{ marginTop: 14, overflow: "hidden", borderRadius: 18, borderWidth: 1, borderColor: colors.border }}>
              <View style={{ height: 300, backgroundColor: "#040b15" }}>
                <CameraView
                  key={`shot-camera-${cameraViewKey}`}
                  ref={cameraRef}
                  style={{ flex: 1 }}
                  mode="video"
                  mute
                  facing={cameraFacing}
                  videoQuality="720p"
                />
                <View
                  style={{
                    position: "absolute",
                    top: 28,
                    left: 20,
                    right: 20,
                    bottom: 28,
                    borderWidth: 2,
                    borderStyle: "dashed",
                    borderColor: colors.success,
                  }}
                />
                <Text
                  style={{
                    position: "absolute",
                    top: 14,
                    left: 14,
                    color: colors.text,
                    fontWeight: "800",
                    letterSpacing: 0.8,
                  }}
                >
                  RECORDING FRAME
                </Text>
                {countdownActive ? (
                  <View
                    pointerEvents="none"
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: "rgba(4, 11, 21, 0.24)",
                    }}
                  >
                    <Text style={{ color: colors.text, fontSize: 72, fontWeight: "900" }}>{countdownValue}</Text>
                    <Text style={{ color: colors.primary, fontSize: 13, fontWeight: "900", textTransform: "uppercase" }}>
                      Get ready
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>
          ) : (
            <PrimaryButton title="Allow Camera" onPress={requestCameraPermission} />
          )}

          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 14, marginTop: 14 }}>
            <View style={{ width: 56, alignItems: "center" }}>
              <TouchableOpacity
                activeOpacity={0.85}
                accessibilityLabel="Open session history"
                onPress={() => {
                  hapticSelection();
                  navigation.navigate("SessionHistory");
                }}
                disabled={busyWithAnalysis || recording || countdownActive}
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 24,
                  alignItems: "center",
                  justifyContent: "center",
                  borderWidth: 1,
                  borderColor: colors.border,
                  backgroundColor: colors.backgroundSoft,
                  opacity: busyWithAnalysis || recording || countdownActive ? 0.45 : 1,
                }}
              >
                <Feather name="clock" size={19} color={colors.text} />
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              activeOpacity={0.86}
              onPress={countdownActive ? cancelRecordingCountdown : recording ? stopRecordingClip : startRecordingClip}
              disabled={!cameraPermission?.granted || busyWithAnalysis || recordingStatus === "Finishing clip..."}
              style={{
                width: 76,
                height: 76,
                borderRadius: 38,
                alignItems: "center",
                justifyContent: "center",
                borderWidth: 5,
                borderColor: recording ? colors.danger : colors.text,
                backgroundColor: "rgba(247, 251, 255, 0.12)",
                opacity: !cameraPermission?.granted || busyWithAnalysis || recordingStatus === "Finishing clip..." ? 0.45 : 1,
              }}
            >
              <View
                style={{
                  width: recording ? 30 : 56,
                  height: recording ? 30 : 56,
                  borderRadius: recording ? 8 : 28,
                  backgroundColor: colors.danger,
                }}
              />
            </TouchableOpacity>
            <View style={{ width: 56, alignItems: "center" }}>
              <TouchableOpacity
                activeOpacity={0.85}
                accessibilityLabel={`Switch camera. Current camera: ${cameraFacing === "front" ? "Front" : "Back"}`}
                onPress={toggleCameraFacing}
                disabled={busyWithAnalysis || recording || countdownActive}
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 24,
                  alignItems: "center",
                  justifyContent: "center",
                  borderWidth: 1,
                  borderColor: colors.border,
                  backgroundColor: colors.backgroundSoft,
                  opacity: busyWithAnalysis || recording || countdownActive ? 0.45 : 1,
                }}
              >
                <Feather name="rotate-cw" size={19} color={colors.text} />
              </TouchableOpacity>
            </View>
          </View>
          <View style={{ marginTop: 10 }}>
            <PrimaryButton
              title={recording ? "Stop Recording" : "Close Camera"}
              onPress={recording ? stopRecordingClip : closeCameraRecorder}
              disabled={busyWithAnalysis}
            />
          </View>
        </View>
      ) : null}

      <View style={commonStyles.card}>
        <Text style={commonStyles.label}>Output Style</Text>
        {OVERLAY_OPTIONS.map((option) => {
          const active = option.id === overlayMode;
          return (
            <TouchableOpacity
              key={option.id}
              onPress={() => setOverlayMode(option.id)}
              disabled={busyWithAnalysis}
              style={{
                marginTop: 12,
                borderRadius: 18,
                borderWidth: 1,
                borderColor: active ? colors.primary : colors.border,
                backgroundColor: active ? "rgba(255, 122, 26, 0.12)" : colors.backgroundSoft,
                padding: 16,
              }}
            >
              <Text style={{ fontSize: 15, fontWeight: "700", color: colors.text }}>{option.title}</Text>
              <Text style={{ marginTop: 4, color: colors.muted, fontSize: 13 }}>{option.description}</Text>
            </TouchableOpacity>
          );
        })}
        <Text style={[commonStyles.subtitle, { color: colors.text }]}>Selected: {selectedOverlay?.title}</Text>
      </View>

      <View style={commonStyles.card}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={commonStyles.label}>Test Mode</Text>
            <Text style={commonStyles.subtitle}>
              Limit analysis to roughly the first 15 seconds so you can quickly validate camera angle and tracking.
            </Text>
          </View>
          <Switch
            value={testMode}
            onValueChange={setTestMode}
            thumbColor="#ffffff"
            trackColor={{ false: colors.border, true: colors.primary }}
            disabled={busyWithAnalysis || recording}
          />
        </View>

        <PrimaryButton
          title={busyWithAnalysis ? "Working..." : "Start Shot Training"}
          onPress={handleStartTraining}
          loading={starting}
          disabled={!selectedVideo || busyWithAnalysis || recording}
        />
      </View>

      <View style={commonStyles.card}>
        <Text style={commonStyles.label}>Live Results</Text>
        <Text style={[commonStyles.subtitle, { color: colors.text }]}>
          Status: {status === "idle" ? "Waiting to start" : status.replace(/_/g, " ")}
        </Text>
        {status === "uploading" || uploadProgress > 0 ? (
          <ProgressMeter label="Upload" value={uploadProgress} color={colors.secondary} />
        ) : null}
        <Text style={[commonStyles.subtitle, { color: colors.text }]}>Progress: {clampPercent(progress)}%</Text>
        <ProgressMeter label="Analysis" value={progress} color={colors.primary} />

        {busyWithAnalysis ? (
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={handleCancelTraining}
            style={{
              marginTop: 14,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: colors.danger,
              backgroundColor: "rgba(255, 123, 123, 0.14)",
              paddingVertical: 12,
              alignItems: "center",
            }}
          >
            <Text style={{ color: colors.danger, fontSize: 13, fontWeight: "900" }}>Cancel Training</Text>
          </TouchableOpacity>
        ) : null}

        {(status === "error" || status === "cancelled") && selectedVideo ? (
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={handleStartTraining}
            style={{
              marginTop: 14,
              borderRadius: 999,
              backgroundColor: colors.primary,
              paddingVertical: 12,
              alignItems: "center",
            }}
          >
            <Text style={{ color: "#091220", fontSize: 13, fontWeight: "900" }}>Retry Training</Text>
          </TouchableOpacity>
        ) : null}

        <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
          <StatCard label="Attempts" value={stats.attempts} color={colors.secondary} />
          <StatCard label="Makes" value={stats.makes} color={colors.success} />
          <StatCard label="Accuracy" value={`${Number(stats.accuracy || 0).toFixed(1)}%`} color={colors.warning} />
        </View>

        <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
          <StatCard label="Misses" value={stats.misses} color={colors.danger} />
          <StatCard label="Grade" value={classification || "--"} color={colors.primary} />
        </View>

        {summary ? (
          <Text style={[commonStyles.subtitle, { marginTop: 14, color: colors.text }]}>{summary}</Text>
        ) : null}

        {errorMessage ? (
          <Text style={{ marginTop: 12, color: colors.danger, fontSize: 13 }}>{errorMessage}</Text>
        ) : null}

        {archiveMessage ? (
          <Text
            style={{
              marginTop: 12,
              color: archiveMessageTone === "success" ? colors.success : colors.warning,
              fontSize: 13,
            }}
          >
            {archiveMessage}
          </Text>
        ) : null}

        {resultVideoUrl ? (
          <>
            <View
              style={{
                marginTop: 16,
                overflow: "hidden",
                borderRadius: 20,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: "#040b15",
              }}
            >
              <ResultVideoPlayer
                videoUrl={resultVideoUrl}
                outputWidth={outputDimensions.width}
                outputHeight={outputDimensions.height}
                speechText={coachingSpeechText}
              />
            </View>
            <Text style={[commonStyles.subtitle, { marginTop: 10, fontSize: 12 }]}>
              Review the annotated output here, then download the file if you want to save or share it.
            </Text>
            <PrimaryButton title="Download Video" onPress={openResultVideo} />
          </>
        ) : null}
      </View>
    </ScrollView>
  );
}

function ProgressMeter({ label, value, color }) {
  const normalizedValue = clampPercent(value);
  return (
    <View style={{ marginTop: 10 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={{ color: colors.text, fontSize: 12, fontWeight: "900" }}>{label}</Text>
        <Text style={{ color: colors.text, fontSize: 12, fontWeight: "900" }}>{normalizedValue}%</Text>
      </View>
      <View
        style={{
          height: 8,
          borderRadius: 999,
          backgroundColor: colors.track,
          overflow: "hidden",
          marginTop: 8,
        }}
      >
        <View style={{ width: `${normalizedValue}%`, height: "100%", borderRadius: 999, backgroundColor: color }} />
      </View>
    </View>
  );
}

function clampPercent(value) {
  const numericValue = Number(value || 0);
  if (!Number.isFinite(numericValue)) {
    return 0;
  }
  return Math.max(0, Math.min(Math.round(numericValue), 100));
}

function ResultVideoPlayer({ videoUrl, outputWidth = 0, outputHeight = 0, speechText = "" }) {
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
  const outputIsLandscape = Number(outputWidth || 0) > Number(outputHeight || 0);
  const videoHeight = outputIsLandscape ? 220 : 320;

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
      </View>
    </View>
  );
}

function SourceButton({ active, title, description, onPress, disabled }) {
  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={onPress}
      disabled={disabled}
      style={{
        flex: 1,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: active ? colors.primary : colors.border,
        backgroundColor: active ? "rgba(255, 122, 26, 0.12)" : colors.backgroundSoft,
        padding: 14,
        opacity: disabled ? 0.65 : 1,
      }}
    >
      <Text style={{ color: colors.text, fontSize: 15, fontWeight: "800" }}>{title}</Text>
      <Text style={{ marginTop: 6, color: colors.muted, fontSize: 12, lineHeight: 18 }}>{description}</Text>
    </TouchableOpacity>
  );
}

function StatCard({ label, value, color }) {
  return (
    <View
      style={{
        flex: 1,
        minHeight: 92,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.cardElevated,
        padding: 14,
      }}
    >
      <Text style={{ fontSize: 9, color: colors.muted, fontWeight: "800", letterSpacing: 0.6, textTransform: "uppercase" }}>
        {label}
      </Text>
      <Text style={{ marginTop: 8, fontSize: 18, fontWeight: "800", color }}>{value}</Text>
    </View>
  );
}
