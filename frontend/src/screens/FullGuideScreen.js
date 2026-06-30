import { Feather } from "@expo/vector-icons";
import React, { useLayoutEffect, useState } from "react";
import { Image, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import CorePoseTutorialVideo from "../components/CorePoseTutorialVideo";
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
        <Text style={styles.poseEyebrow}>Reference Tutorial Video</Text>
        <Text style={styles.referenceIntro}>
          Follow this tutorial as the drill reference. SureBall's pose checks and phase scores are aligned with the
          same core movements shown here.
        </Text>
        <CorePoseTutorialVideo
          source={guide.tutorialVideo || guide.motionGif}
          fallbackImage={guide.image}
          accessibilityLabel={`${guide.modeTitle} tutorial video`}
        />
        <TouchableOpacity
          accessibilityLabel={`Open tutorial source from ${guide.tutorialCredit}`}
          activeOpacity={0.82}
          onPress={() => void Linking.openURL(guide.tutorialUrl)}
          style={styles.tutorialAttribution}
        >
          <Feather name="external-link" size={13} color={colors.secondary} />
          <Text style={styles.tutorialAttributionText}>Source: {guide.tutorialCredit}</Text>
        </TouchableOpacity>
        {guide.motionGif ? (
          <View style={styles.motionPreviewCard}>
            <View style={styles.motionHeaderRow}>
              <Feather name="repeat" size={14} color={colors.primary} />
              <Text style={styles.motionPreviewTitle}>Quick Form GIF</Text>
            </View>
            <Text style={styles.motionPreviewText}>
              Use this looping preview to quickly visualize the main movement shape before watching the full tutorial.
            </Text>
            <Image
              source={guide.motionGif}
              accessibilityLabel={`${guide.modeTitle} looping form preview`}
              style={styles.motionGif}
              resizeMode="contain"
            />
          </View>
        ) : null}
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
  referenceIntro: {
    marginTop: 8,
    color: colors.text,
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "700",
  },
  tutorialAttribution: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingTop: 9,
    paddingHorizontal: 2,
  },
  tutorialAttributionText: {
    color: colors.secondary,
    fontSize: 11,
    fontWeight: "800",
    textDecorationLine: "underline",
  },
  motionPreviewCard: {
    marginTop: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    padding: 12,
  },
  motionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  motionPreviewTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  motionPreviewText: {
    marginTop: 7,
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "700",
  },
  motionGif: {
    width: "100%",
    height: 180,
    marginTop: 10,
    borderRadius: 12,
    backgroundColor: colors.backgroundSoft,
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
