import React from "react";
import { ScrollView, Text, View } from "react-native";
import { commonStyles } from "../theme/styles";
import ModeCard from "../components/ModeCard";

const MODES = [
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
    id: "footwork",
    title: "Footwork",
    tag: "Movement",
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
    <ScrollView style={commonStyles.screen} contentContainerStyle={commonStyles.screenBottomSpace}>
      <View style={commonStyles.heroCard}>
        <Text style={commonStyles.eyebrow}>Training Deck</Text>
        <Text style={[commonStyles.title, { marginTop: 10 }]}>Choose Your Next Drill</Text>
        <Text style={commonStyles.subtitle}>
          Build the session around the skill you want to sharpen right now, from shot mechanics to defensive posture.
        </Text>
      </View>

      {MODES.map((mode) => (
        <ModeCard
          key={mode.id}
          title={mode.title}
          tag={mode.tag}
          description={mode.description}
          onPress={() => openMode(mode)}
        />
      ))}
    </ScrollView>
  );
}
