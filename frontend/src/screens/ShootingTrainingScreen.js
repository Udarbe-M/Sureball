import { useEvent } from "expo";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as DocumentPicker from "expo-document-picker";
import { VideoView, useVideoPlayer } from "expo-video";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Linking, ScrollView, Switch, Text, TouchableOpacity, View } from "react-native";
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
import { commonStyles } from "../theme/styles";
import { colors } from "../theme/colors";
import { buildUserKey } from "../utils/userKey";

const OVERLAY_OPTIONS = [
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

const INITIAL_STATS = {
  attempts: 0,
  makes: 0,
  misses: 0,
  accuracy: 0,
};

export default function ShootingTrainingScreen() {
  const { playerEmail, playerName, userId } = useAuth();
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [videoSource, setVideoSource] = useState("upload");
  const [overlayMode, setOverlayMode] = useState("stats_only");
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
  const [recording, setRecording] = useState(false);
  const [recordingStatus, setRecordingStatus] = useState("Ready to record a new clip.");
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
        const result = await fetchShootingTrainingStatus(jobId);
        setProgress(clampPercent(result.progress_percentage));
        setStats(result.stats || INITIAL_STATS);
        setSummary(result.summary || "");
        setClassification(result.classification || "");

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
    setRecordingStatus("Frame the shooter and rim, then start recording.");
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
          name: `live-shot-training-${Date.now()}.mp4`,
          mimeType: "video/mp4",
        });
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
    setRecording(false);
    setCameraOpen(false);
    setRecordingStatus("Ready to record a new clip.");
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
  }

  const busyWithAnalysis = status === "processing" || status === "uploading" || starting;

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
                  RECORDING FRAME
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
                loading={false}
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
              <ResultVideoPlayer videoUrl={resultVideoUrl} />
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
