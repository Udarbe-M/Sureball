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

export default function CoachingModeScreen({ navigation }) {
  function openMode(mode) {
    navigation.navigate("LiveAnalysis", { mode });
  }

  return (
    <ScrollView style={commonStyles.screen} contentContainerStyle={commonStyles.screenBottomSpace}>
      <View style={commonStyles.heroCard}>
        <Text style={commonStyles.eyebrow}>Training Deck</Text>
        <Text style={[commonStyles.title, { marginTop: 10 }]}>Choose Your Next Drill</Text>
        <Text style={commonStyles.subtitle}>
          Pick a drill, then upload or record a clip so SureBall can generate a playable coaching video with feedback.
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
