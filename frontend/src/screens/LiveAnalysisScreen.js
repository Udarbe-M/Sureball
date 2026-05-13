import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Image, ScrollView, Text, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { commonStyles } from "../theme/styles";
import PrimaryButton from "../components/PrimaryButton";
import { analyzeFrame } from "../services/api";
import { saveSessionRecord } from "../services/storage";
import { colors } from "../theme/colors";
import { normalizeClassification } from "../utils/helpers";

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

  const modeLabel = useMemo(() => mode?.title || "Coaching", [mode]);

  useEffect(() => {
    if (!permission) {
      return;
    }
    if (!permission.granted) {
      requestPermission();
    }
  }, [permission, requestPermission]);

  async function captureAndAnalyzeFrame() {
    if (!cameraRef.current || isAnalyzing) return;
    setIsAnalyzing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.5,
        skipProcessing: true,
      });
      const result = await analyzeFrame({ mode: mode.id, photoUri: photo.uri });
      const firstCue = result.feedback?.[0]?.message || "No cue available.";
      const scoreValue = result.score?.score ?? 0;
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
      setClassification(normalizeClassification(result.score?.classification));
      setErrors(detectedErrors);
      setLastSessionId(result.session_id);

      if (result.annotated_frame_base64) {
        setAnnotatedFrame(`data:image/jpeg;base64,${result.annotated_frame_base64}`);
      }

      await saveSessionRecord({
        id: result.session_id,
        playerName,
        playerEmail,
        mode: mode.id,
        modeLabel: mode.title,
        score: scoreValue,
        classification: normalizeClassification(result.score?.classification),
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
      <View style={[commonStyles.screen, { justifyContent: "center" }]}>
        <Text style={commonStyles.title}>Camera Permission Needed</Text>
        <Text style={commonStyles.subtitle}>Allow camera access so SureBall can run live analysis.</Text>
        <PrimaryButton title="Allow Camera" onPress={requestPermission} />
      </View>
    );
  }

  return (
    <ScrollView style={commonStyles.screen}>
      <View style={commonStyles.card}>
        <Text style={commonStyles.title}>{modeLabel}</Text>
        <Text style={commonStyles.subtitle}>Player: {playerName}</Text>
      </View>

      <View style={[commonStyles.card, { padding: 0, overflow: "hidden" }]}>
        <View style={{ height: 360, backgroundColor: "#0f172a" }}>
          <CameraView ref={cameraRef} style={{ flex: 1 }} facing="back" />
          <View
            style={{
              position: "absolute",
              top: 40,
              left: 24,
              right: 24,
              bottom: 20,
              borderWidth: 2,
              borderStyle: "dashed",
              borderColor: "#34d399",
            }}
          />
          <View
            style={{
              position: "absolute",
              top: 120,
              right: 30,
              width: 78,
              height: 78,
              borderWidth: 2,
              borderColor: "#fb923c",
            }}
          />
          <Text
            style={{
              position: "absolute",
              top: 10,
              left: 10,
              color: "#fff",
              fontWeight: "700",
            }}
          >
            Skeletal Overlay Placeholder
          </Text>
          <Text
            style={{
              position: "absolute",
              top: 95,
              right: 18,
              color: "#fb923c",
              fontWeight: "700",
              fontSize: 12,
            }}
          >
            Ball Box Placeholder
          </Text>
        </View>
      </View>

      <PrimaryButton
        title={isAnalyzing ? "Analyzing..." : "Capture and Analyze Frame"}
        onPress={captureAndAnalyzeFrame}
        loading={isAnalyzing}
      />

      <View style={commonStyles.card}>
        <Text style={commonStyles.label}>Real-Time Feedback</Text>
        <Text style={[commonStyles.subtitle, { marginTop: 8, color: colors.text }]}>{feedbackText}</Text>
        <Text style={{ marginTop: 12, fontSize: 18, fontWeight: "700", color: colors.secondary }}>
          Score: {score} ({classification})
        </Text>
        {lastSessionId ? (
          <Text style={{ marginTop: 6, color: colors.muted, fontSize: 12 }}>Session ID: {lastSessionId}</Text>
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

      {annotatedFrame ? (
        <View style={commonStyles.card}>
          <Text style={commonStyles.label}>Latest Annotated Frame</Text>
          <Image source={{ uri: annotatedFrame }} style={{ marginTop: 10, width: "100%", height: 220, borderRadius: 10 }} />
        </View>
      ) : null}

      {isAnalyzing ? <ActivityIndicator style={{ marginBottom: 20 }} /> : null}

      <View style={{ marginBottom: 30 }} />
    </ScrollView>
  );
}
