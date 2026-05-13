import React from "react";
import { ScrollView, Text, View } from "react-native";
import { commonStyles } from "../theme/styles";
import ModeCard from "../components/ModeCard";

const MODES = [
  {
    id: "shooting_form",
    title: "Shooting Form",
    description: "Analyze elbow alignment, wrist control, knee bend, and shooting balance.",
  },
  {
    id: "defensive_stance",
    title: "Defensive Stance",
    description: "Evaluate stance width, low base, torso readiness, and body balance.",
  },
  {
    id: "footwork",
    title: "Footwork",
    description: "Assess spacing, posture stability, movement timing, and coordination.",
  },
];

export default function CoachingModeScreen({ navigation, route }) {
  const playerName = route.params?.playerName || "Student Athlete";
  const playerEmail = route.params?.playerEmail || null;

  function openMode(mode) {
    navigation.navigate("LiveAnalysis", {
      mode,
      playerName,
      playerEmail,
    });
  }

  return (
    <ScrollView style={commonStyles.screen}>
      <View style={commonStyles.card}>
        <Text style={commonStyles.title}>Select Mode</Text>
        <Text style={commonStyles.subtitle}>Choose a coaching mode for this session.</Text>
      </View>

      {MODES.map((mode) => (
        <ModeCard
          key={mode.id}
          title={mode.title}
          description={mode.description}
          onPress={() => openMode(mode)}
        />
      ))}
    </ScrollView>
  );
}
