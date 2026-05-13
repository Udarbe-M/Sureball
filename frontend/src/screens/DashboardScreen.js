import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { commonStyles } from "../theme/styles";
import PrimaryButton from "../components/PrimaryButton";
import { healthCheck } from "../services/api";
import { colors } from "../theme/colors";

export default function DashboardScreen({ navigation, route }) {
  const playerName = route.params?.playerName || "Student Athlete";
  const playerEmail = route.params?.playerEmail || null;
  const userPersisted = route.params?.userPersisted;
  const [backendStatus, setBackendStatus] = useState("Checking...");

  useEffect(() => {
    let mounted = true;
    healthCheck()
      .then(() => mounted && setBackendStatus("Connected"))
      .catch(() => mounted && setBackendStatus("Not reachable"));
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <View style={commonStyles.screen}>
      <View style={commonStyles.card}>
        <Text style={commonStyles.title}>Welcome, {playerName}</Text>
        <Text style={commonStyles.subtitle}>Prototype thesis app for real-time basketball coaching feedback.</Text>
        {playerEmail ? (
          <Text style={[commonStyles.subtitle, { marginTop: 6 }]}>Email: {playerEmail}</Text>
        ) : null}
        <Text style={{ marginTop: 12, color: backendStatus === "Connected" ? colors.success : colors.danger }}>
          Backend: {backendStatus}
        </Text>
        <Text style={{ marginTop: 6, color: userPersisted ? colors.success : colors.warning }}>
          User DB: {userPersisted ? "Saved to Supabase" : "Local fallback (Supabase not configured)"}
        </Text>
      </View>

      <View style={commonStyles.card}>
        <Text style={commonStyles.label}>Start Coaching Session</Text>
        <Text style={commonStyles.subtitle}>Choose a movement mode and begin live camera analysis.</Text>
        <PrimaryButton title="Choose Mode" onPress={() => navigation.navigate("CoachingModes", { playerName, playerEmail })} />
      </View>

      <View style={commonStyles.card}>
        <Text style={commonStyles.label}>Review Previous Sessions</Text>
        <Text style={commonStyles.subtitle}>See score, classification, and detected errors from prior runs.</Text>
        <PrimaryButton title="Open Session History" onPress={() => navigation.navigate("SessionHistory")} />
      </View>
    </View>
  );
}
