import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { commonStyles } from "../theme/styles";
import PrimaryButton from "../components/PrimaryButton";
import { analyzeFrame } from "../services/api";
import { saveSessionRecord } from "../services/storage";
import { colors } from "../theme/colors";
import { normalizeClassification } from "../utils/helpers";

function formatBallZone(zone) {
  if (!zone) {
    return "Waiting";
  }
  if (zone === "high") {
    return "High";
  }
  if (zone === "torso") {
    return "Pocket";
  }
  return "Low";
}

function describeBallControl(distanceValue) {
  if (typeof distanceValue !== "number") {
    return "Waiting";
  }
  if (distanceValue <= 0.42) {
    return "Tight";
  }
  if (distanceValue <= 0.72) {
    return "Stable";
  }
  return "Loose";
}

function TrackingBadge({ label, value, tone = "neutral" }) {
  const accentColor =
    tone === "success" ? colors.success : tone === "warning" ? colors.warning : colors.secondary;

  return (
    <View
      style={{
        paddingHorizontal: 12,
        paddingVertical: 9,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: accentColor,
        backgroundColor: "rgba(7, 17, 31, 0.82)",
      }}
    >
      <Text style={{ color: colors.muted, fontSize: 10, fontWeight: "800", letterSpacing: 1 }}>
        {label}
      </Text>
      <Text style={{ color: colors.text, fontSize: 13, fontWeight: "800", marginTop: 3 }}>{value}</Text>
    </View>
  );
}

export default function LiveAnalysisScreen({ route }) {
  const mode = route.params?.mode || { id: "shooting_form", title: "Shooting Form" };
  const playerName = route.params?.playerName || "Student Athlete";
  const playerEmail = route.params?.playerEmail || null;

  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [feedbackText, setFeedbackText] = useState("Ready to analyze.");
  const [score, setScore] = useState(100);
  const [classification, setClassification] = useState("Excellent");
  const [errors, setErrors] = useState([]);
  const [annotatedFrame, setAnnotatedFrame] = useState(null);
  const [lastSessionId, setLastSessionId] = useState(null);
  const [latestAnalysis, setLatestAnalysis] = useState(null);
  const [previewMode, setPreviewMode] = useState("camera");

  const modeLabel = useMemo(() => mode?.title || "Coaching", [mode]);
  const landmarkCount = useMemo(
    () => Object.keys(latestAnalysis?.landmarks || {}).length,
    [latestAnalysis]
  );
  const ballConfidence = latestAnalysis?.ball_box?.confidence ?? null;
  const ballZone = formatBallZone(latestAnalysis?.features?.ball_vertical_zone);
  const ballControl = describeBallControl(latestAnalysis?.features?.ball_to_wrist_distance);
  const overlayReady = Boolean(annotatedFrame && latestAnalysis);

  useEffect(() => {
    if (!permission) {
      return;
    }
    if (!permission.granted) {
      requestPermission();
    }
  }, [permission, requestPermission]);

  async function captureAndAnalyzeFrame() {
    if (!cameraRef.current || isAnalyzing) {
      return;
    }

    setIsAnalyzing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.5,
        skipProcessing: true,
      });
      const result = await analyzeFrame({ mode: mode.id, photoUri: photo.uri });
      const firstCue = result.feedback?.[0]?.message || "No cue available.";
      const scoreValue = result.score?.score ?? 0;
      const normalizedClassification = normalizeClassification(result.score?.classification);
      const detectedErrors = (result.feedback || [])
        .filter((item) => item.deduction > 0)
        .map((item) => ({
          issue: item.message,
          severity:
            item.severity === "high" ? "Major" : item.severity === "medium" ? "Moderate" : "Minor",
          deduction: item.deduction,
        }));

      setFeedbackText(firstCue);
      setScore(scoreValue);
      setClassification(normalizedClassification);
      setErrors(detectedErrors);
      setLastSessionId(result.session_id);
      setLatestAnalysis(result);

      if (result.annotated_frame_base64) {
        setAnnotatedFrame(`data:image/jpeg;base64,${result.annotated_frame_base64}`);
        setPreviewMode("analysis");
      } else {
        setAnnotatedFrame(null);
        setPreviewMode("camera");
      }

      await saveSessionRecord({
        id: result.session_id,
        playerName,
        playerEmail,
        mode: mode.id,
        modeLabel: mode.title,
        score: scoreValue,
        classification: normalizedClassification,
        detectedErrors,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      setFeedbackText(`Analysis failed: ${String(error.message || error)}`);
    } finally {
      setIsAnalyzing(false);
    }
  }

  if (!permission?.granted) {
    return (
      <View style={commonStyles.screenCentered}>
        <Text style={commonStyles.title}>Camera Permission Needed</Text>
        <Text style={commonStyles.subtitle}>Allow camera access so SureBall can run live analysis.</Text>
        <PrimaryButton title="Allow Camera" onPress={requestPermission} />
      </View>
    );
  }

  return (
    <ScrollView style={commonStyles.screen} contentContainerStyle={commonStyles.screenBottomSpace}>
      <View style={commonStyles.heroCard}>
        <Text style={commonStyles.eyebrow}>Live Drill</Text>
        <Text style={[commonStyles.title, { marginTop: 10 }]}>{modeLabel}</Text>
        <Text style={commonStyles.subtitle}>Player: {playerName}</Text>
        <Text style={[commonStyles.subtitle, { color: colors.text }]}>
          Capture a frame to combine MediaPipe pose landmarks with YOLO ball tracking.
        </Text>
      </View>

      <View style={[commonStyles.card, { padding: 0, overflow: "hidden" }]}>
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            paddingHorizontal: 18,
            paddingVertical: 14,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
            backgroundColor: colors.backgroundSoft,
          }}
        >
          <View>
            <Text style={commonStyles.label}>Analysis View</Text>
            <Text style={[commonStyles.subtitle, { marginTop: 4 }]}>
              {overlayReady
                ? "Switch between the live camera and the latest tracked overlay."
                : "Capture a frame to unlock the tracked overlay view."}
            </Text>
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TouchableOpacity
              onPress={() => setPreviewMode("camera")}
              style={[
                commonStyles.pill,
                previewMode === "camera" && { borderColor: colors.primary, backgroundColor: colors.cardElevated },
              ]}
            >
              <Text style={commonStyles.pillText}>Live Camera</Text>
            </TouchableOpacity>
            <TouchableOpacity
              disabled={!overlayReady}
              onPress={() => overlayReady && setPreviewMode("analysis")}
              style={[
                commonStyles.pill,
                previewMode === "analysis" && overlayReady
                  ? { borderColor: colors.secondary, backgroundColor: colors.cardElevated }
                  : null,
                !overlayReady && { opacity: 0.45 },
              ]}
            >
              <Text style={commonStyles.pillText}>Last Overlay</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={{ height: 380, backgroundColor: "#040b15" }}>
          {previewMode === "analysis" && overlayReady ? (
            <Image source={{ uri: annotatedFrame }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
          ) : (
            <CameraView ref={cameraRef} style={{ flex: 1 }} facing="back" />
          )}

          <View
            style={{
              position: "absolute",
              top: 18,
              left: 18,
              right: 18,
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "flex-start",
            }}
          >
            <View
              style={{
                paddingHorizontal: 12,
                paddingVertical: 10,
                borderRadius: 16,
                backgroundColor: "rgba(7, 17, 31, 0.82)",
                borderWidth: 1,
                borderColor: previewMode === "analysis" ? colors.secondary : colors.primary,
                maxWidth: "68%",
              }}
            >
              <Text style={{ color: colors.muted, fontSize: 10, fontWeight: "800", letterSpacing: 1 }}>
                {previewMode === "analysis" ? "TRACKED OVERLAY" : "LIVE CAMERA"}
              </Text>
              <Text style={{ color: colors.text, fontSize: 15, fontWeight: "800", marginTop: 4 }}>
                {previewMode === "analysis" ? "YOLO Ball + MediaPipe Pose" : "Frame up the player and the ball"}
              </Text>
            </View>

            <View
              style={{
                paddingHorizontal: 10,
                paddingVertical: 9,
                borderRadius: 14,
                backgroundColor: "rgba(7, 17, 31, 0.82)",
                borderWidth: 1,
                borderColor: colors.warning,
              }}
            >
              <Text style={{ color: colors.muted, fontSize: 10, fontWeight: "800", letterSpacing: 1 }}>
                RESULT
              </Text>
              <Text style={{ color: colors.text, fontSize: 13, fontWeight: "800", marginTop: 3 }}>
                {classification}
              </Text>
            </View>
          </View>

          {previewMode === "camera" ? (
            <View
              style={{
                position: "absolute",
                top: 52,
                left: 28,
                right: 28,
                bottom: 28,
                borderWidth: 2,
                borderStyle: "dashed",
                borderColor: colors.success,
                borderRadius: 18,
              }}
            />
          ) : null}

          <View
            style={{
              position: "absolute",
              left: 18,
              right: 18,
              bottom: 18,
              flexDirection: "row",
              flexWrap: "wrap",
              gap: 10,
            }}
          >
            <TrackingBadge
              label="POSE"
              value={latestAnalysis?.pose_detected ? "Locked" : "Searching"}
              tone={latestAnalysis?.pose_detected ? "success" : "warning"}
            />
            <TrackingBadge
              label="BALL"
              value={latestAnalysis?.ball_detected ? "Locked" : "Searching"}
              tone={latestAnalysis?.ball_detected ? "success" : "warning"}
            />
            <TrackingBadge
              label="LANDMARKS"
              value={landmarkCount > 0 ? String(landmarkCount) : "0"}
              tone={landmarkCount > 0 ? "success" : "warning"}
            />
            <TrackingBadge
              label="BALL CONF"
              value={ballConfidence !== null ? `${Math.round(ballConfidence * 100)}%` : "Waiting"}
              tone={ballConfidence !== null ? "success" : "warning"}
            />
          </View>
        </View>
      </View>

      <PrimaryButton
        title={isAnalyzing ? "Analyzing..." : "Capture and Analyze Frame"}
        onPress={captureAndAnalyzeFrame}
        loading={isAnalyzing}
      />

      <View style={{ flexDirection: "row", gap: 12, marginTop: 14, marginBottom: 14 }}>
        <View style={commonStyles.metricTile}>
          <Text style={commonStyles.metricLabel}>Score</Text>
          <Text style={commonStyles.metricValue}>{score}</Text>
        </View>
        <View style={commonStyles.metricTile}>
          <Text style={commonStyles.metricLabel}>Ball Control</Text>
          <Text style={commonStyles.metricValue}>{ballControl}</Text>
        </View>
      </View>

      <View style={{ flexDirection: "row", gap: 12, marginBottom: 14 }}>
        <View style={commonStyles.metricTile}>
          <Text style={commonStyles.metricLabel}>Ball Zone</Text>
          <Text style={commonStyles.metricValue}>{ballZone}</Text>
        </View>
        <View style={commonStyles.metricTile}>
          <Text style={commonStyles.metricLabel}>Class</Text>
          <Text style={[commonStyles.metricValue, { fontSize: 18 }]}>{classification}</Text>
        </View>
      </View>

      <View style={commonStyles.card}>
        <Text style={commonStyles.label}>Real-Time Feedback</Text>
        <Text style={[commonStyles.subtitle, { marginTop: 8, color: colors.text }]}>{feedbackText}</Text>
        {latestAnalysis?.coaching_summary ? (
          <Text style={commonStyles.subtitle}>{latestAnalysis.coaching_summary}</Text>
        ) : null}
        {lastSessionId ? (
          <Text style={{ marginTop: 10, color: colors.muted, fontSize: 12 }}>Session ID: {lastSessionId}</Text>
        ) : null}
      </View>

      <View style={commonStyles.card}>
        <Text style={commonStyles.label}>Detected Errors</Text>
        {errors.length === 0 ? (
          <Text style={commonStyles.subtitle}>No major errors detected in the latest frame.</Text>
        ) : (
          errors.map((item, idx) => (
            <Text key={`${item.issue}-${idx}`} style={[commonStyles.subtitle, { color: colors.text }]}>
              - {item.issue} ({item.severity}, -{item.deduction})
            </Text>
          ))
        )}
      </View>

      {isAnalyzing ? <ActivityIndicator style={{ marginBottom: 20 }} /> : null}

      <View style={{ marginBottom: 30 }} />
    </ScrollView>
  );
}
