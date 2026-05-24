import React, { useState } from "react";
import { ScrollView, Text, TouchableOpacity, View } from "react-native";
import PrimaryButton from "../components/PrimaryButton";
import { useAuth } from "../context/AuthContext";
import { colors } from "../theme/colors";
import { commonStyles } from "../theme/styles";
import { getDailyTip } from "../utils/tips";

export default function DashboardScreen({ navigation }) {
  const { playerName } = useAuth();
  const dailyTip = useState(() => getDailyTip())[0];

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
        eyebrow="Unified Hub"
        title="Start Unified Coaching Session"
        description="Choose coaching analysis or shooting training from one shared session flow."
        accentColor={colors.primary}
        action={
          <PrimaryButton title="Open Session Hub" onPress={() => navigation.navigate("UnifiedCoachingSession")} />
        }
      />

      <ActionCard
        eyebrow="Shot Lab"
        title="Jump Straight To Shooting Training"
        description="Open the same unified session screen with shooting training selected and ready."
        accentColor={colors.secondary}
        action={
          <PrimaryButton
            title="Open Shooting Training"
            onPress={() =>
              navigation.navigate("UnifiedCoachingSession", {
                initialSessionType: "shooting_training",
              })
            }
          />
        }
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
