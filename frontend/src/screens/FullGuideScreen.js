import React, { useLayoutEffect, useState } from "react";
import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { getModeGuide } from "../data/modeGuides";
import { colors } from "../theme/colors";
import { commonStyles } from "../theme/styles";

function GuideSection({ title, items }) {
  return (
    <View style={styles.sectionCard}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {items.map((item) => (
        <View key={`${title}-${item}`} style={styles.bulletRow}>
          <View style={styles.bulletDot} />
          <Text style={styles.bulletText}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

export default function FullGuideScreen({ route, navigation }) {
  const modeId = route.params?.modeId || "shooting_form";
  const guide = getModeGuide(modeId);
  const [guideLevel, setGuideLevel] = useState("beginner");
  const levelItems = guideLevel === "intermediate" ? guide.intermediateGuide : guide.beginnerGuide;

  useLayoutEffect(() => {
    navigation.setOptions({ title: `${guide.modeTitle} Guide` });
  }, [guide.modeTitle, navigation]);

  return (
    <ScrollView style={commonStyles.screen} contentContainerStyle={styles.content}>
      <View style={commonStyles.heroCard}>
        <Text style={commonStyles.eyebrow}>{guide.modeTitle}</Text>
        <Text style={[commonStyles.title, styles.heroTitle]}>{guide.fullGuideTitle}</Text>
        <Text style={commonStyles.subtitle}>{guide.fullGuideIntro}</Text>
      </View>

      <View style={styles.poseCard}>
        <Text style={styles.poseEyebrow}>Ideal Form</Text>
        <Image source={guide.image} accessibilityLabel={guide.imageAlt} style={styles.poseImage} resizeMode="contain" />
        <Text style={styles.poseHeadline}>{guide.poseHeadline}</Text>
      </View>

      <View style={styles.levelCard}>
        <Text style={styles.sectionTitle}>Choose Guide Level</Text>
        <View style={styles.levelSelector}>
          {["beginner", "intermediate"].map((level) => {
            const active = guideLevel === level;
            return (
              <TouchableOpacity
                key={level}
                activeOpacity={0.9}
                onPress={() => setGuideLevel(level)}
                style={[styles.levelButton, active && styles.levelButtonActive]}
              >
                <Text style={[styles.levelButtonText, active && styles.levelButtonTextActive]}>
                  {level === "beginner" ? "Beginner" : "Intermediate"}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text style={styles.levelHelp}>
          {guideLevel === "intermediate"
            ? "Use this when the basic form is stable and you want cleaner mechanics."
            : "Use this when you want simple form targets before worrying about advanced detail."}
        </Text>
      </View>

      <GuideSection
        title={guideLevel === "intermediate" ? "Intermediate Guide" : "Beginner Guide"}
        items={levelItems}
      />
      <GuideSection title="Key Form Cues" items={guide.keyCues} />
      <GuideSection title="Common Mistakes" items={guide.commonMistakes} />
      <GuideSection title="How SureBall Scores This" items={guide.scoringNotes} />
      <GuideSection title="Practice Focus" items={guide.practiceFocus} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: 32,
  },
  heroTitle: {
    marginTop: 8,
  },
  poseCard: {
    ...commonStyles.card,
    padding: 16,
  },
  poseEyebrow: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  poseImage: {
    width: "100%",
    height: 420,
    marginTop: 12,
    borderRadius: 18,
    backgroundColor: colors.backgroundSoft,
    borderWidth: 1,
    borderColor: colors.border,
  },
  poseHeadline: {
    marginTop: 14,
    color: colors.text,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "700",
  },
  levelCard: {
    ...commonStyles.card,
    marginTop: 0,
  },
  levelSelector: {
    marginTop: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.backgroundSoft,
    flexDirection: "row",
    padding: 4,
    gap: 4,
  },
  levelButton: {
    flex: 1,
    minHeight: 38,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  levelButtonActive: {
    backgroundColor: colors.primary,
  },
  levelButtonText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "900",
  },
  levelButtonTextActive: {
    color: "#091220",
  },
  levelHelp: {
    marginTop: 10,
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "700",
  },
  sectionCard: {
    ...commonStyles.card,
    marginTop: 0,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "900",
  },
  bulletRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginTop: 10,
  },
  bulletDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 7,
    backgroundColor: colors.primary,
  },
  bulletText: {
    flex: 1,
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "700",
  },
});
