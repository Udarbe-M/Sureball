import React, { useEffect, useState } from "react";
import { ScrollView, Text, TouchableOpacity, View } from "react-native";
import PrimaryButton from "../components/PrimaryButton";
import { useAuth } from "../context/AuthContext";
import { healthCheck } from "../services/api";
import { colors } from "../theme/colors";
import { commonStyles } from "../theme/styles";
import { getDailyTip } from "../utils/tips";

export default function DashboardScreen({ navigation }) {
  const { isGuest, playerEmail, playerName, profile } = useAuth();
  const userPersisted = Boolean(profile?.id) && !isGuest;
  const [backendStatus, setBackendStatus] = useState("Checking...");
  const dailyTip = useState(() => getDailyTip())[0];

  useEffect(() => {
    let mounted = true;
    healthCheck()
      .then(() => mounted && setBackendStatus("Connected"))
      .catch(() => mounted && setBackendStatus("Offline"));
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <ScrollView style={commonStyles.screen} contentContainerStyle={commonStyles.screenBottomSpace}>
      <View style={commonStyles.heroCard}>
        <View
          style={{
            position: "absolute",
            right: -34,
            top: -30,
            width: 138,
            height: 138,
            borderRadius: 69,
            backgroundColor: "rgba(255, 122, 26, 0.14)",
          }}
        />
        <Text style={commonStyles.eyebrow}>Game Day Dashboard</Text>
        <Text style={[commonStyles.title, { marginTop: 10 }]}>Welcome Back, {playerName}</Text>
        <Text style={commonStyles.subtitle}>
          Load a live drill, review session data, or run a shooting breakdown from one courtside control panel.
        </Text>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 18 }}>
          <StatusPill
            label={`Backend ${backendStatus}`}
            color={backendStatus === "Connected" ? colors.success : colors.danger}
          />
          <StatusPill
            label={isGuest ? "Guest Profile" : userPersisted ? "Supabase Profile" : "Profile Pending"}
            color={isGuest ? colors.accent : userPersisted ? colors.secondary : colors.warning}
          />
        </View>

        {playerEmail ? (
          <Text style={[commonStyles.subtitle, { marginTop: 16, color: colors.text }]}>Athlete email: {playerEmail}</Text>
        ) : null}
        {isGuest ? (
          <Text style={[commonStyles.subtitle, { marginTop: 16, color: colors.text }]}>
            Guest mode is stored locally for quick testing on this device.
          </Text>
        ) : null}
      </View>

      <View style={{ flexDirection: "row", gap: 12, marginBottom: 14 }}>
        <MetricTile label="System" value={backendStatus === "Connected" ? "READY" : "CHECK"} color={colors.secondary} />
        <MetricTile label="Profile" value={isGuest ? "GUEST" : userPersisted ? "SYNCED" : "CHECK"} color={colors.primary} />
      </View>

      <View style={[commonStyles.card, { overflow: "hidden" }]}>
        <View
          style={{
            position: "absolute",
            right: -22,
            top: -22,
            width: 92,
            height: 92,
            borderRadius: 46,
            backgroundColor: "rgba(110, 203, 255, 0.12)",
          }}
        />
        <Text style={commonStyles.eyebrow}>Tip Of The Day</Text>
        <Text style={[commonStyles.sectionTitle, { marginTop: 10 }]}>{dailyTip.title}</Text>
        <Text style={commonStyles.subtitle}>{dailyTip.body}</Text>
      </View>

      <ActionCard
        eyebrow="Live Drill"
        title="Start Coaching Session"
        description="Choose a mode and open the camera flow for real-time basketball feedback."
        accentColor={colors.primary}
        action={
          <PrimaryButton title="Choose Mode" onPress={() => navigation.navigate("CoachingModes")} />
        }
      />

      <ActionCard
        eyebrow="Shot Lab"
        title="Train Shooting With Video"
        description="Upload a shooting clip to break down attempts, makes, misses, and overall percentage."
        accentColor={colors.secondary}
        action={
          <PrimaryButton title="Open Shooting Training" onPress={() => navigation.navigate("ShootingTraining")} />
        }
      />

      <ActionCard
        eyebrow="Player Menu"
        title="Edit Player Name"
        description="Open your player menu to change your player name, update your password, or sign out."
        accentColor={colors.accent}
        action={<PrimaryButton title="Open Menu" onPress={() => navigation.navigate("PlayerMenu")} />}
      />

      <TouchableOpacity
        activeOpacity={0.9}
        onPress={() => navigation.navigate("SessionHistory")}
        style={commonStyles.card}
      >
        <Text style={commonStyles.eyebrow}>Film Room</Text>
        <Text style={[commonStyles.sectionTitle, { marginTop: 10 }]}>Review Previous Sessions</Text>
        <Text style={commonStyles.subtitle}>See prior scores, classifications, and summaries from live and video runs.</Text>
        <Text style={{ marginTop: 16, color: colors.accent, fontWeight: "800", letterSpacing: 0.8 }}>OPEN SESSION HISTORY</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function StatusPill({ label, color }) {
  return (
    <View
      style={[
        commonStyles.pill,
        {
          backgroundColor: "rgba(7, 17, 31, 0.28)",
          borderColor: color,
        },
      ]}
    >
      <Text style={[commonStyles.pillText, { color }]}>{label}</Text>
    </View>
  );
}

function MetricTile({ label, value, color }) {
  return (
    <View style={commonStyles.metricTile}>
      <Text style={commonStyles.metricLabel}>{label}</Text>
      <Text style={[commonStyles.metricValue, { color }]}>{value}</Text>
    </View>
  );
}

function ActionCard({ eyebrow, title, description, accentColor, action }) {
  return (
    <View style={[commonStyles.card, { overflow: "hidden" }]}>
      <View
        style={{
          position: "absolute",
          right: -30,
          top: -18,
          width: 110,
          height: 110,
          borderRadius: 55,
          backgroundColor: `${accentColor}22`,
        }}
      />
      <View
        style={{
          width: 56,
          height: 6,
          borderRadius: 999,
          backgroundColor: accentColor,
          marginBottom: 14,
        }}
      />
      <Text style={commonStyles.eyebrow}>{eyebrow}</Text>
      <Text style={[commonStyles.sectionTitle, { marginTop: 10 }]}>{title}</Text>
      <Text style={commonStyles.subtitle}>{description}</Text>
      {action}
    </View>
  );
}
