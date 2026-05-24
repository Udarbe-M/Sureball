import { useEvent } from "expo";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as DocumentPicker from "expo-document-picker";
import { VideoView, useVideoPlayer } from "expo-video";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Linking, ScrollView, Switch, Text, TouchableOpacity, View } from "react-native";
import PrimaryButton from "../components/PrimaryButton";
import { useAuth } from "../context/AuthContext";
import {
  buildCoachingVideoDownloadUrl,
  buildShootingTrainingDownloadUrl,
  fetchCoachingVideoStatus,
  fetchShootingTrainingStatus,
  startCoachingVideoAnalysis,
  startShootingTraining,
} from "../services/api";
import { saveAnnotatedVideoLocally, saveSessionRecord } from "../services/storage";
import { colors } from "../theme/colors";
import { commonStyles } from "../theme/styles";
import { buildUserKey } from "../utils/userKey";

const SESSION_TYPES = [
  {
    id: "coaching_video",
    title: "Coaching Analysis",
    description: "Review a full rep with score, feedback cues, and an annotated coaching video.",
  },
  {
    id: "shooting_training",
    title: "Shooting Training",
    description: "Track attempts, makes, misses, and shooting accuracy from one focused clip.",
  },
];

const COACHING_MODES = [
  {
    id: "shooting_form",
    title: "Shooting Form",
    tag: "Precision",
    description: "Analyze elbow alignment, wrist control, knee bend, and shooting balance.",
  },
  {
    id: "defensive_stance",
    title: "Defensive Stance",
    tag: "Defense",
    description: "Evaluate stance width, low base, torso readiness, and body balance.",
  },
  {
    id: "basic_footwork",
    title: "Footwork",
    tag: "Movement",
    description: "Assess spacing, posture stability, movement timing, and coordination.",
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
    title: "Focus Feedback",
    description: "Prioritize coaching cues and score panels with a cleaner training-video presentation.",
  },
  {
    id: "score_only",
    title: "Score Only",
    description: "Keep the output clean with the scoreboard and footer only.",
  },
];

const SHOOTING_OVERLAY_OPTIONS = [
  {
    id: "full_tracking",
    title: "Full Tracking",
    description: "Show all tracked basketball, hoop, and shooter detections in the output video.",
  },
  {
    id: "stats_only",
    title: "Stats Only",
    description: "Only show attempts, makes, misses, and accuracy in the final video.",
  },
];

const INITIAL_COACHING_RESULTS = {
  analyzedFrames: 0,
  averageScore: 0,
  bestScore: 0,
  worstScore: 0,
  classification: "",
  summary: "",
  dominantFeedback: [],
};

const INITIAL_SHOT_STATS = {
  attempts: 0,
  makes: 0,
  misses: 0,
  accuracy: 0,
};

function getDefaultOverlayMode(sessionType) {
  return sessionType === "shooting_training" ? "stats_only" : "focus_feedback";
}

export default function UnifiedCoachingSessionScreen({ route }) {
  const initialSessionType = route.params?.initialSessionType === "shooting_training" ? "shooting_training" : "coaching_video";
  const { playerEmail, playerName, userId } = useAuth();
  const [sessionType, setSessionType] = useState(initialSessionType);
  const [coachingModeId, setCoachingModeId] = useState("shooting_form");
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [videoSource, setVideoSource] = useState("upload");
  const [overlayMode, setOverlayMode] = useState(getDefaultOverlayMode(initialSessionType));
  const [testMode, setTestMode] = useState(false);
  const [jobId, setJobId] = useState(null);
  const [status, setStatus] = useState("idle");
  const [progress, setProgress] = useState(0);
  const [coachingResults, setCoachingResults] = useState(INITIAL_COACHING_RESULTS);
  const [shotStats, setShotStats] = useState(INITIAL_SHOT_STATS);
  const [errorMessage, setErrorMessage] = useState("");
  const [archiveMessage, setArchiveMessage] = useState("");
  const [archiveMessageTone, setArchiveMessageTone] = useState("neutral");
  const [starting, setStarting] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingStatus, setRecordingStatus] = useState("Ready to record a coaching clip.");
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const cameraRef = useRef(null);
  const userKey = useMemo(
    () => buildUserKey({ userId, playerName, playerEmail }),
    [playerEmail, playerName, userId]
  );
  const activeCoachingMode = useMemo(
    () => COACHING_MODES.find((item) => item.id === coachingModeId) || COACHING_MODES[0],
    [coachingModeId]
  );
  const activeSession = useMemo(
    () => SESSION_TYPES.find((item) => item.id === sessionType) || SESSION_TYPES[0],
    [sessionType]
  );
  const overlayOptions = useMemo(
    () => (sessionType === "shooting_training" ? SHOOTING_OVERLAY_OPTIONS : COACHING_OVERLAY_OPTIONS),
    [sessionType]
  );
  const selectedOverlay = useMemo(
    () => overlayOptions.find((item) => item.id === overlayMode),
    [overlayMode, overlayOptions]
  );
  const resultVideoUrl = useMemo(() => {
    if (!jobId || status !== "completed") {
      return null;
    }
    return sessionType === "shooting_training"
      ? buildShootingTrainingDownloadUrl(jobId)
      : buildCoachingVideoDownloadUrl(jobId);
  }, [jobId, sessionType, status]);
  const selectedVideoLabel = useMemo(() => {
    if (!selectedVideo) {
      return sessionType === "shooting_training" ? "No shooting clip selected yet." : "No coaching clip selected yet.";
    }
    return selectedVideo.name || (videoSource === "camera" ? "Recorded training clip" : "Chosen training clip");
  }, [selectedVideo, sessionType, videoSource]);

  useEffect(() => {
    if (route.params?.initialSessionType !== "shooting_training" && route.params?.initialSessionType !== "coaching_video") {
      return;
    }
    setSessionType(route.params.initialSessionType);
    setOverlayMode(getDefaultOverlayMode(route.params.initialSessionType));
    setCameraOpen(false);
    setRecording(false);
    setRecordingStatus(buildRecordingReadyText(route.params.initialSessionType));
    resetRunState();
  }, [route.params?.initialSessionType]);

  useEffect(() => {
    if (!jobId || status !== "processing") {
      return undefined;
    }

    const timer = setInterval(async () => {
      try {
        if (sessionType === "shooting_training") {
          const result = await fetchShootingTrainingStatus(jobId);
          setProgress(result.progress_percentage || 0);
          setShotStats(result.stats || INITIAL_SHOT_STATS);

          if (result.status === "completed") {
            const archivedAt = new Date().toISOString();
            const remoteVideoUrl = buildShootingTrainingDownloadUrl(jobId);
            let localVideoUri = "";

            try {
              localVideoUri = await saveAnnotatedVideoLocally({
                remoteUrl: remoteVideoUrl,
                sessionId: jobId,
                mode: "shooting_training",
                timestamp: archivedAt,
                suffix: "shot-lab",
              });
              setArchiveMessageTone("success");
              setArchiveMessage("Annotated video saved on this phone for offline playback in Session History.");
            } catch (downloadError) {
              setArchiveMessageTone("warning");
              setArchiveMessage(
                `Training finished, but the offline video copy could not be saved: ${String(downloadError.message || downloadError)}`
              );
            }

            setCoachingResults((current) => ({
              ...current,
              summary: result.summary || "",
              classification: result.classification || "",
            }));
            setStatus("completed");
            await saveSessionRecord(userKey, {
              id: jobId,
              userKey,
              playerName,
              playerEmail,
              mode: "shooting_training",
              modeLabel: "Shooting Training",
              score: Number(result.stats?.accuracy || 0),
              classification: result.classification || "Needs Improvement",
              detectedErrors: [],
              timestamp: archivedAt,
              summary: result.summary || "",
              localVideoUri: localVideoUri || null,
            });
          } else if (result.status === "error") {
            setStatus("error");
            setErrorMessage(result.error_message || "Shot training failed.");
          }
          return;
        }

        const result = await fetchCoachingVideoStatus(jobId);
        setProgress(result.progress_percentage || 0);
        setCoachingResults({
          analyzedFrames: result.analyzed_frames || 0,
          averageScore: result.average_score || 0,
          bestScore: result.best_score || 0,
          worstScore: result.worst_score || 0,
          classification: result.classification || "",
          summary: result.summary || "",
          dominantFeedback: result.dominant_feedback || [],
        });

        if (result.status === "completed") {
          const archivedAt = new Date().toISOString();
          const remoteVideoUrl = buildCoachingVideoDownloadUrl(result.file_id);
          let localVideoUri = "";

          try {
            localVideoUri = await saveAnnotatedVideoLocally({
              remoteUrl: remoteVideoUrl,
              sessionId: result.file_id,
              mode: coachingModeId,
              timestamp: archivedAt,
              suffix: "coaching",
            });
            setArchiveMessageTone("success");
            setArchiveMessage("Annotated video saved on this phone for offline playback in Session History.");
          } catch (downloadError) {
            setArchiveMessageTone("warning");
            setArchiveMessage(
              `Analysis finished, but the offline video copy could not be saved: ${String(downloadError.message || downloadError)}`
            );
          }

          setStatus("completed");
          await saveSessionRecord(userKey, {
            id: result.file_id,
            userKey,
            playerName,
            playerEmail,
            mode: coachingModeId,
            modeLabel: activeCoachingMode.title,
            score: result.average_score || 0,
            classification: result.classification || "Needs Improvement",
            detectedErrors: (result.dominant_feedback || []).map((message) => ({
              issue: message,
              severity: "Moderate",
            })),
            timestamp: archivedAt,
            summary: result.summary || "",
            localVideoUri: localVideoUri || null,
          });
        } else if (result.status === "error") {
          setStatus("error");
          setErrorMessage(result.error_message || "Coaching video analysis failed.");
        }
      } catch (error) {
        setStatus("error");
        setErrorMessage(String(error.message || error));
      }
    }, 1500);

    return () => clearInterval(timer);
  }, [activeCoachingMode.title, coachingModeId, jobId, playerEmail, playerName, sessionType, status, userKey]);

  useEffect(() => {
    return () => {
      if (cameraRef.current && recording) {
        cameraRef.current.stopRecording();
      }
    };
  }, [recording]);

  async function pickVideo() {
    const result = await DocumentPicker.getDocumentAsync({
      type: "video/*",
      copyToCacheDirectory: true,
    });
    if (result.canceled) {
      return;
    }

    setVideoSource("upload");
    setSelectedVideo(result.assets[0]);
    setCameraOpen(false);
    resetRunState();
  }

  async function openCameraRecorder() {
    if (!cameraPermission?.granted) {
      const permissionResult = await requestCameraPermission();
      if (!permissionResult.granted) {
        setErrorMessage("Camera permission is required to record a training clip.");
        return;
      }
    }

    setVideoSource("camera");
    setCameraOpen(true);
    setRecordingStatus(buildRecordingFrameText(sessionType));
    setErrorMessage("");
  }

  async function startRecordingClip() {
    if (!cameraRef.current || recording) {
      return;
    }

    setErrorMessage("");
    setRecording(true);
    setRecordingStatus("Recording in progress...");

    try {
      const result = await cameraRef.current.recordAsync({
        maxDuration: testMode ? 15 : 30,
      });

      if (result?.uri) {
        setSelectedVideo({
          uri: result.uri,
          name:
            sessionType === "shooting_training"
              ? `live-shot-training-${Date.now()}.mp4`
              : `coaching-drill-${Date.now()}.mp4`,
          mimeType: "video/mp4",
        });
        setRecordingStatus(
          sessionType === "shooting_training"
            ? "Recorded shot training clip ready for analysis."
            : "Recorded coaching clip ready for analysis."
        );
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
    cameraRef.current.stopRecording();
    setRecordingStatus("Finishing clip...");
  }

  function closeCameraRecorder() {
    if (recording && cameraRef.current) {
      cameraRef.current.stopRecording();
    }
    setRecording(false);
    setCameraOpen(false);
    setRecordingStatus(buildRecordingReadyText(sessionType));
  }

  function handleSessionTypeChange(nextType) {
    setSessionType(nextType);
    setOverlayMode(getDefaultOverlayMode(nextType));
    setCameraOpen(false);
    setRecording(false);
    setRecordingStatus(buildRecordingReadyText(nextType));
    resetRunState();
  }

  function handleCoachingModeChange(nextModeId) {
    setCoachingModeId(nextModeId);
    resetRunState();
  }

  async function handleStartSession() {
    if (!selectedVideo) {
      return;
    }

    setStarting(true);
    setStatus("starting");
    setErrorMessage("");
    setArchiveMessage("");
    setArchiveMessageTone("neutral");
    setProgress(0);
    setCoachingResults(INITIAL_COACHING_RESULTS);
    setShotStats(INITIAL_SHOT_STATS);

    try {
      if (sessionType === "shooting_training") {
        const result = await startShootingTraining({
          videoAsset: selectedVideo,
          overlayMode,
          testMode,
          userKey,
        });
        setJobId(result.file_id);
      } else {
        const result = await startCoachingVideoAnalysis({
          mode: coachingModeId,
          videoAsset: selectedVideo,
          overlayMode,
          testMode,
          userKey,
        });
        setJobId(result.file_id);
      }
      setStatus("processing");
    } catch (error) {
      setStatus("error");
      setErrorMessage(String(error.message || error));
    } finally {
      setStarting(false);
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
    setCoachingResults(INITIAL_COACHING_RESULTS);
    setShotStats(INITIAL_SHOT_STATS);
    setErrorMessage("");
    setArchiveMessage("");
    setArchiveMessageTone("neutral");
  }

  return (
    <ScrollView style={commonStyles.screen} contentContainerStyle={commonStyles.screenBottomSpace}>
      <View style={commonStyles.heroCard}>
        <Text style={commonStyles.eyebrow}>Unified Session</Text>
        <Text style={[commonStyles.title, { marginTop: 10 }]}>Coaching Session Hub</Text>
        <Text style={commonStyles.subtitle}>Player: {playerName}</Text>
        <Text style={[commonStyles.subtitle, { color: colors.text }]}>
          Run coaching analysis and shooting training from one place, with shared recording, upload, and review controls.
        </Text>
      </View>

      <View style={commonStyles.card}>
        <Text style={commonStyles.label}>Session Type</Text>
        <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
          {SESSION_TYPES.map((item) => (
            <ToggleCard
              key={item.id}
              active={sessionType === item.id}
              title={item.title}
              description={item.description}
              onPress={() => handleSessionTypeChange(item.id)}
              disabled={status === "processing" || starting || recording}
            />
          ))}
        </View>
        <Text style={[commonStyles.subtitle, { marginTop: 14, color: colors.text }]}>
          Active session: {activeSession.title}
        </Text>
      </View>

      {sessionType === "coaching_video" ? (
        <View style={commonStyles.card}>
          <Text style={commonStyles.label}>Coaching Mode</Text>
          {COACHING_MODES.map((mode) => {
            const active = coachingModeId === mode.id;
            return (
              <TouchableOpacity
                key={mode.id}
                activeOpacity={0.9}
                onPress={() => handleCoachingModeChange(mode.id)}
                disabled={status === "processing" || starting || recording}
                style={{
                  marginTop: 12,
                  borderRadius: 18,
                  borderWidth: 1,
                  borderColor: active ? colors.primary : colors.border,
                  backgroundColor: active ? "rgba(255, 122, 26, 0.12)" : colors.backgroundSoft,
                  padding: 16,
                }}
              >
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 15, fontWeight: "800", color: colors.text }}>{mode.title}</Text>
                    <Text style={{ marginTop: 4, color: colors.muted, fontSize: 13 }}>{mode.description}</Text>
                  </View>
                  <View
                    style={{
                      alignSelf: "flex-start",
                      paddingHorizontal: 10,
                      paddingVertical: 6,
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: "rgba(110, 203, 255, 0.28)",
                      backgroundColor: "rgba(110, 203, 255, 0.12)",
                    }}
                  >
                    <Text style={{ color: colors.secondary, fontSize: 10, fontWeight: "800", letterSpacing: 1 }}>
                      {mode.tag.toUpperCase()}
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>
            );
          })}
          <Text style={[commonStyles.subtitle, { marginTop: 14, color: colors.text }]}>
            Selected mode: {activeCoachingMode.title}
          </Text>
        </View>
      ) : null}

      <View style={commonStyles.card}>
        <Text style={commonStyles.label}>Clip Source</Text>
        <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
          <SourceButton
            active={videoSource === "upload"}
            title="Choose Video"
            description={sessionType === "shooting_training" ? "Pick a shooting clip" : "Pick a drill clip"}
            onPress={pickVideo}
            disabled={status === "processing" || starting || recording}
          />
          <SourceButton
            active={videoSource === "camera"}
            title="Record Live"
            description={sessionType === "shooting_training" ? "Capture a shot rep now" : "Capture a coaching rep"}
            onPress={openCameraRecorder}
            disabled={status === "processing" || starting}
          />
        </View>
        <Text style={[commonStyles.subtitle, { marginTop: 14, color: colors.text }]}>Selected: {selectedVideoLabel}</Text>
        <Text style={[commonStyles.subtitle, { fontSize: 12 }]}>
          {sessionType === "shooting_training"
            ? "Tip: keep the full shot path and rim visible for cleaner attempt tracking."
            : "Tip: keep the full athlete in frame and avoid rapid camera movement for steadier pose feedback."}
        </Text>
      </View>

      {cameraOpen ? (
        <View style={commonStyles.card}>
          <Text style={commonStyles.label}>Live Camera Recorder</Text>
          <Text style={commonStyles.subtitle}>{recordingStatus}</Text>
          {cameraPermission?.granted ? (
            <View style={{ marginTop: 14, overflow: "hidden", borderRadius: 18, borderWidth: 1, borderColor: colors.border }}>
              <View style={{ height: 300, backgroundColor: "#040b15" }}>
                <CameraView
                  ref={cameraRef}
                  style={{ flex: 1 }}
                  mode="video"
                  mute
                  facing="back"
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
                  {sessionType === "shooting_training" ? "SHOT TRAINING FRAME" : "COACHING FRAME"}
                </Text>
              </View>
            </View>
          ) : (
            <PrimaryButton title="Allow Camera" onPress={requestCameraPermission} />
          )}

          <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
            <View style={{ flex: 1 }}>
              <PrimaryButton
                title={recording ? "Recording..." : "Start Recording"}
                onPress={startRecordingClip}
                disabled={!cameraPermission?.granted || recording}
              />
            </View>
            <View style={{ flex: 1 }}>
              <PrimaryButton
                title={recording ? "Stop Recording" : "Close Camera"}
                onPress={recording ? stopRecordingClip : closeCameraRecorder}
                disabled={starting || status === "processing"}
              />
            </View>
          </View>
        </View>
      ) : null}

      <View style={commonStyles.card}>
        <Text style={commonStyles.label}>Output Style</Text>
        {overlayOptions.map((option) => {
          const active = option.id === overlayMode;
          return (
            <TouchableOpacity
              key={option.id}
              onPress={() => setOverlayMode(option.id)}
              disabled={status === "processing" || starting}
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
              Limit processing to roughly the first 15 seconds so you can quickly validate framing and output quality.
            </Text>
          </View>
          <Switch
            value={testMode}
            onValueChange={setTestMode}
            thumbColor="#ffffff"
            trackColor={{ false: colors.border, true: colors.primary }}
            disabled={status === "processing" || starting || recording}
          />
        </View>

        <PrimaryButton
          title={
            starting || status === "processing"
              ? "Analyzing..."
              : sessionType === "shooting_training"
                ? "Start Shooting Training"
                : "Start Coaching Analysis"
          }
          onPress={handleStartSession}
          loading={starting}
          disabled={!selectedVideo || status === "processing" || recording}
        />
      </View>

      <View style={commonStyles.card}>
        <Text style={commonStyles.label}>Live Results</Text>
        <Text style={[commonStyles.subtitle, { color: colors.text }]}>
          Status: {status === "idle" ? "Waiting to start" : status.replace(/_/g, " ")}
        </Text>
        <Text style={[commonStyles.subtitle, { color: colors.text }]}>Progress: {progress}%</Text>

        {sessionType === "shooting_training" ? (
          <>
            <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
              <StatCard label="Attempts" value={shotStats.attempts} color={colors.secondary} />
              <StatCard label="Makes" value={shotStats.makes} color={colors.success} />
              <StatCard label="Accuracy" value={`${Number(shotStats.accuracy || 0).toFixed(1)}%`} color={colors.warning} />
            </View>

            <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
              <StatCard label="Misses" value={shotStats.misses} color={colors.danger} />
              <StatCard label="Grade" value={coachingResults.classification || "--"} color={colors.primary} />
            </View>
          </>
        ) : (
          <>
            <Text style={[commonStyles.subtitle, { color: colors.text }]}>
              Analyzed frames: {coachingResults.analyzedFrames}
            </Text>

            <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
              <StatCard label="Average" value={coachingResults.averageScore.toFixed(1)} color={colors.secondary} />
              <StatCard label="Best" value={coachingResults.bestScore || "--"} color={colors.success} />
              <StatCard label="Worst" value={coachingResults.worstScore || "--"} color={colors.warning} />
            </View>

            <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
              <StatCard label="Grade" value={coachingResults.classification || "--"} color={colors.primary} />
              <StatCard label="Mode" value={activeCoachingMode.title} color={colors.accent} />
            </View>

            {coachingResults.dominantFeedback.length > 0 ? (
              <View style={{ marginTop: 14 }}>
                <Text style={commonStyles.label}>Top Focus Areas</Text>
                {coachingResults.dominantFeedback.map((item, index) => (
                  <Text key={`${item}-${index}`} style={[commonStyles.subtitle, { color: colors.text }]}>
                    - {item}
                  </Text>
                ))}
              </View>
            ) : null}
          </>
        )}

        {coachingResults.summary ? (
          <Text style={[commonStyles.subtitle, { marginTop: 14, color: colors.text }]}>{coachingResults.summary}</Text>
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
              <ResultVideoPlayer videoUrl={resultVideoUrl} />
            </View>
            <Text style={[commonStyles.subtitle, { marginTop: 10, fontSize: 12 }]}>
              Review the annotated output here, then download the file if you want to keep or share the clip.
            </Text>
            <PrimaryButton title="Download Video" onPress={openResultVideo} />
          </>
        ) : null}
      </View>
    </ScrollView>
  );
}

function buildRecordingReadyText(sessionType) {
  return sessionType === "shooting_training"
    ? "Ready to record a shot training clip."
    : "Ready to record a coaching clip.";
}

function buildRecordingFrameText(sessionType) {
  return sessionType === "shooting_training"
    ? "Frame the shooter and rim, then start recording."
    : "Frame the athlete fully, then start recording.";
}

function ToggleCard({ active, title, description, onPress, disabled }) {
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
