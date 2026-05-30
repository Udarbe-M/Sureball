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
  cancelCoachingVideoAnalysis,
  fetchCoachingVideoStatus,
  startCoachingVideoAnalysis,
} from "../services/api";
import { Haptics, hapticImpact, hapticSelection, hapticSuccess, hapticWarning } from "../services/haptics";
import { archiveCompletedSession } from "../services/sessionArchive";
import { colors } from "../theme/colors";
import { commonStyles } from "../theme/styles";
import { buildUserKey } from "../utils/userKey";

const OVERLAY_OPTIONS = [
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

export default function LiveAnalysisScreen({ route }) {
  const { playerEmail, playerName, userId } = useAuth();
  const mode = route.params?.mode || { id: "shooting_form", title: "Shooting" };
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [videoSource, setVideoSource] = useState("upload");
  const [overlayMode, setOverlayMode] = useState("focus_feedback");
  const [testMode, setTestMode] = useState(false);
  const [jobId, setJobId] = useState(null);
  const [status, setStatus] = useState("idle");
  const [progress, setProgress] = useState(0);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [analyzedFrames, setAnalyzedFrames] = useState(0);
  const [averageScore, setAverageScore] = useState(0);
  const [bestScore, setBestScore] = useState(0);
  const [worstScore, setWorstScore] = useState(0);
  const [classification, setClassification] = useState("");
  const [summary, setSummary] = useState("");
  const [dominantFeedback, setDominantFeedback] = useState([]);
  const [errorMessage, setErrorMessage] = useState("");
  const [archiveMessage, setArchiveMessage] = useState("");
  const [archiveMessageTone, setArchiveMessageTone] = useState("neutral");
  const [starting, setStarting] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingStatus, setRecordingStatus] = useState("Ready to record a coaching drill.");
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const cameraRef = useRef(null);
  const uploadAbortRef = useRef(null);
  const userKey = useMemo(
    () => buildUserKey({ userId, playerName, playerEmail }),
    [playerEmail, playerName, userId]
  );

  useEffect(() => {
    if (!jobId || status !== "processing") {
      return undefined;
    }

    const timer = setInterval(async () => {
      try {
        const result = await fetchCoachingVideoStatus(jobId);
        setProgress(clampPercent(result.progress_percentage));
        setAnalyzedFrames(result.analyzed_frames || 0);
        setAverageScore(result.average_score || 0);
        setBestScore(result.best_score || 0);
        setWorstScore(result.worst_score || 0);
        setClassification(result.classification || "");
        setSummary(result.summary || "");
        setDominantFeedback(result.dominant_feedback || []);

        if (result.status === "completed") {
          const archivedAt = new Date().toISOString();
          const remoteVideoUrl = buildCoachingVideoDownloadUrl(result.file_id);
          const archiveResult = await archiveCompletedSession({
            userKey,
            remoteVideoUrl,
            videoSaveOptions: {
              sessionId: result.file_id,
              mode: mode.id,
              timestamp: archivedAt,
              suffix: "coaching",
            },
            record: {
              id: result.file_id,
              userKey,
              playerName,
              playerEmail,
              mode: mode.id,
              modeLabel: mode.title,
              score: result.average_score || 0,
              classification: result.classification || "Needs Improvement",
              detectedErrors: (result.dominant_feedback || []).map((message) => ({
                issue: message,
                severity: "Moderate",
              })),
              timestamp: archivedAt,
              summary: result.summary || "",
            },
            messages: {
              success: "Annotated video saved on this phone for offline playback in Session History.",
              disabled: "Analysis finished. Automatic video saving is turned off in Settings.",
              failurePrefix: "Analysis finished, but the offline video copy could not be saved",
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
  }, [jobId, mode.id, mode.title, playerEmail, playerName, status, userKey]);

  useEffect(() => {
    return () => {
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
    return buildCoachingVideoDownloadUrl(jobId);
  }, [jobId, status]);
  const selectedVideoLabel = useMemo(() => {
    if (!selectedVideo) {
      return "No coaching clip selected yet.";
    }
    return selectedVideo.name || (videoSource === "camera" ? "Recorded coaching drill" : "Chosen coaching clip");
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
    setCameraOpen(false);
    resetRunState();
  }

  async function openCameraRecorder() {
    hapticSelection();
    if (!cameraPermission?.granted) {
      const permissionResult = await requestCameraPermission();
      if (!permissionResult.granted) {
        setErrorMessage("Camera permission is required to record a coaching drill.");
        return;
      }
    }

    setVideoSource("camera");
    setCameraOpen(true);
    setRecordingStatus("Frame the athlete fully, then start recording.");
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
          name: `coaching-drill-${Date.now()}.mp4`,
          mimeType: "video/mp4",
        });
        setRecordingStatus("Recorded coaching clip ready for analysis.");
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
    setRecording(false);
    setCameraOpen(false);
    setRecordingStatus("Ready to record a coaching drill.");
  }

  async function handleStartAnalysis() {
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
    setDominantFeedback([]);
    setAverageScore(0);
    setBestScore(0);
    setWorstScore(0);
    setAnalyzedFrames(0);
    setProgress(0);
    setUploadProgress(0);

    try {
      hapticImpact(Haptics.ImpactFeedbackStyle.Medium);
      const abortController = new AbortController();
      uploadAbortRef.current = abortController;
      setStatus("uploading");
      const result = await startCoachingVideoAnalysis({
        mode: mode.id,
        videoAsset: selectedVideo,
        overlayMode,
        testMode,
        userKey,
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

  async function handleCancelAnalysis() {
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
    if (!jobId) {
      return;
    }
    await Linking.openURL(buildCoachingVideoDownloadUrl(jobId));
  }

  function resetRunState() {
    setJobId(null);
    setStatus("idle");
    setProgress(0);
    setAnalyzedFrames(0);
    setAverageScore(0);
    setBestScore(0);
    setWorstScore(0);
    setClassification("");
    setSummary("");
    setDominantFeedback([]);
    setErrorMessage("");
    setArchiveMessage("");
    setArchiveMessageTone("neutral");
    setUploadProgress(0);
  }

  const busyWithAnalysis = status === "processing" || status === "uploading" || starting;

  return (
    <ScrollView style={commonStyles.screen} contentContainerStyle={commonStyles.screenBottomSpace}>
      <View style={commonStyles.heroCard}>
        <Text style={commonStyles.eyebrow}>Coaching Video</Text>
        <Text style={[commonStyles.title, { marginTop: 10 }]}>{mode.title}</Text>
        <Text style={commonStyles.subtitle}>Player: {playerName}</Text>
        <Text style={[commonStyles.subtitle, { color: colors.text }]}>
          Upload a practice clip or record one live, then review the annotated coaching result directly in the app.
        </Text>
      </View>

      <View style={commonStyles.card}>
        <Text style={commonStyles.label}>Clip Source</Text>
        <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
          <SourceButton
            active={videoSource === "upload"}
            title="Choose Video"
            description="Pick a saved drill clip"
            onPress={pickVideo}
            disabled={busyWithAnalysis || recording}
          />
          <SourceButton
            active={videoSource === "camera"}
            title="Record Live"
            description="Capture a new coaching rep"
            onPress={openCameraRecorder}
            disabled={busyWithAnalysis}
          />
        </View>
        <Text style={[commonStyles.subtitle, { marginTop: 14, color: colors.text }]}>Selected: {selectedVideoLabel}</Text>
        <Text style={[commonStyles.subtitle, { fontSize: 12 }]}>
          Tip: keep the full body in frame and avoid rapid camera movement for steadier pose feedback.
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
                  COACHING FRAME
                </Text>
              </View>
            </View>
          ) : (
            <PrimaryButton title="Allow Camera" onPress={requestCameraPermission} />
          )}

          <View style={{ alignItems: "center", marginTop: 14 }}>
            <View style={{ width: "72%", maxWidth: 280 }}>
              <PrimaryButton
                title={recording ? "Recording..." : "Start Recording"}
                onPress={startRecordingClip}
                disabled={!cameraPermission?.granted || recording || busyWithAnalysis}
              />
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
              Limit processing to roughly the first 15 seconds so you can quickly validate framing and output quality.
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
          title={busyWithAnalysis ? "Working..." : "Start Coaching Analysis"}
          onPress={handleStartAnalysis}
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
        <Text style={[commonStyles.subtitle, { color: colors.text }]}>Analyzed frames: {analyzedFrames}</Text>

        {busyWithAnalysis ? (
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={handleCancelAnalysis}
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
            <Text style={{ color: colors.danger, fontSize: 13, fontWeight: "900" }}>Cancel Analysis</Text>
          </TouchableOpacity>
        ) : null}

        {(status === "error" || status === "cancelled") && selectedVideo ? (
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={handleStartAnalysis}
            style={{
              marginTop: 14,
              borderRadius: 999,
              backgroundColor: colors.primary,
              paddingVertical: 12,
              alignItems: "center",
            }}
          >
            <Text style={{ color: "#091220", fontSize: 13, fontWeight: "900" }}>Retry Analysis</Text>
          </TouchableOpacity>
        ) : null}

        <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
          <StatCard label="Average" value={averageScore.toFixed(1)} color={colors.secondary} />
          <StatCard label="Best" value={bestScore || "--"} color={colors.success} />
          <StatCard label="Worst" value={worstScore || "--"} color={colors.warning} />
        </View>

        <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
          <StatCard label="Grade" value={classification || "--"} color={colors.primary} />
          <StatCard label="Mode" value={mode.title} color={colors.accent} />
        </View>

        {dominantFeedback.length > 0 ? (
          <View style={{ marginTop: 14 }}>
            <Text style={commonStyles.label}>Top Focus Areas</Text>
            {dominantFeedback.map((item, index) => (
              <Text key={`${item}-${index}`} style={[commonStyles.subtitle, { color: colors.text }]}>
                - {item}
              </Text>
            ))}
          </View>
        ) : null}

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
              <ResultVideoPlayer videoUrl={resultVideoUrl} />
            </View>
            <Text style={[commonStyles.subtitle, { marginTop: 10, fontSize: 12 }]}>
              Review the annotated coaching output here, then download the file if you want to keep or share the clip.
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
