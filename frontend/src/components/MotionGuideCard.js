import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Image, Text, View } from "react-native";
import { colors } from "../theme/colors";

function normalizePhase(phase, index) {
  return {
    id: phase?.id || `phase-${index}`,
    label: phase?.label || `Step ${index + 1}`,
    cue: phase?.cue || "",
    transform: {
      scale: Number(phase?.transform?.scale || 1),
      translateX: Number(phase?.transform?.translateX || 0),
      translateY: Number(phase?.transform?.translateY || 0),
    },
  };
}

export default function MotionGuideCard({
  source,
  accessibilityLabel,
  phases = [],
  height = 220,
  containerStyle,
}) {
  const normalizedPhases = useMemo(() => {
    const safePhases = Array.isArray(phases) ? phases : [];
    return safePhases.length > 0
      ? safePhases.map((phase, index) => normalizePhase(phase, index))
      : [
          normalizePhase(
            {
              id: "pose",
              label: "Form",
              cue: "Use this pose as the target shape.",
            },
            0
          ),
        ];
  }, [phases]);

  const animationValue = useRef(new Animated.Value(0)).current;
  const [activeIndex, setActiveIndex] = useState(0);
  const activePhase = normalizedPhases[activeIndex] || normalizedPhases[0];
  const phaseCount = normalizedPhases.length;

  useEffect(() => {
    animationValue.stopAnimation();
    animationValue.setValue(0);
    setActiveIndex(0);

    if (phaseCount <= 1) {
      return undefined;
    }

    let cancelled = false;
    let timeoutId = null;
    let nextIndex = 1;

    const scheduleNext = () => {
      timeoutId = setTimeout(() => {
        if (cancelled) {
          return;
        }

        Animated.timing(animationValue, {
          toValue: nextIndex,
          duration: 900,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }).start(({ finished }) => {
          if (!finished || cancelled) {
            return;
          }
          setActiveIndex(nextIndex);
          nextIndex = (nextIndex + 1) % phaseCount;
          scheduleNext();
        });
      }, 1600);
    };

    scheduleNext();

    return () => {
      cancelled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      animationValue.stopAnimation();
    };
  }, [animationValue, phaseCount]);

  const phaseInputRange = normalizedPhases.map((_, index) => index);
  const scaleOutputRange = normalizedPhases.map((phase) => phase.transform.scale);
  const translateXOutputRange = normalizedPhases.map((phase) => phase.transform.translateX);
  const translateYOutputRange = normalizedPhases.map((phase) => phase.transform.translateY);

  const animatedStyle = {
    transform: [
      {
        scale:
          phaseCount > 1
            ? animationValue.interpolate({
                inputRange: phaseInputRange,
                outputRange: scaleOutputRange,
              })
            : scaleOutputRange[0],
      },
      {
        translateX:
          phaseCount > 1
            ? animationValue.interpolate({
                inputRange: phaseInputRange,
                outputRange: translateXOutputRange,
              })
            : translateXOutputRange[0],
      },
      {
        translateY:
          phaseCount > 1
            ? animationValue.interpolate({
                inputRange: phaseInputRange,
                outputRange: translateYOutputRange,
              })
            : translateYOutputRange[0],
      },
    ],
  };

  return (
    <View
      style={[
        {
          borderRadius: 18,
          backgroundColor: colors.backgroundSoft,
          borderWidth: 1,
          borderColor: colors.border,
          overflow: "hidden",
        },
        containerStyle,
      ]}
    >
      <View style={{ height, overflow: "hidden", backgroundColor: colors.backgroundSoft }}>
        <Animated.View style={[{ width: "100%", height: "100%" }, animatedStyle]}>
          <Image
            source={source}
            accessibilityLabel={accessibilityLabel}
            style={{ width: "100%", height: "100%" }}
            resizeMode="contain"
          />
        </Animated.View>
        <View
          style={{
            position: "absolute",
            top: 12,
            left: 12,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: colors.primary,
            backgroundColor: "rgba(15, 23, 32, 0.76)",
            paddingHorizontal: 10,
            paddingVertical: 6,
          }}
        >
          <Text
            style={{
              color: colors.primary,
              fontSize: 10,
              fontWeight: "900",
              textTransform: "uppercase",
            }}
          >
            {activePhase.label}
          </Text>
        </View>
        {phaseCount > 1 ? (
          <View
            style={{
              position: "absolute",
              right: 12,
              top: 12,
              flexDirection: "row",
              gap: 6,
            }}
          >
            {normalizedPhases.map((phase, index) => {
              const active = index === activeIndex;
              return (
                <View
                  key={phase.id}
                  style={{
                    minWidth: 28,
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: active ? colors.primary : "rgba(247, 251, 255, 0.2)",
                    backgroundColor: active ? colors.primary : "rgba(15, 23, 32, 0.6)",
                    paddingHorizontal: 8,
                    paddingVertical: 5,
                    alignItems: "center",
                  }}
                >
                  <Text
                    style={{
                      color: active ? "#091220" : colors.text,
                      fontSize: 10,
                      fontWeight: "900",
                    }}
                  >
                    {index + 1}
                  </Text>
                </View>
              );
            })}
          </View>
        ) : null}
      </View>

      {phaseCount > 1 ? (
        <View style={{ padding: 12, gap: 8 }}>
          <Text style={{ color: colors.text, fontSize: 13, fontWeight: "900" }}>{activePhase.cue}</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {normalizedPhases.map((phase, index) => {
              const active = index === activeIndex;
              return (
                <View
                  key={`${phase.id}-cue`}
                  style={{
                    flex: 1,
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: active ? colors.primary : colors.border,
                    backgroundColor: active ? "rgba(255, 122, 26, 0.12)" : "rgba(7, 17, 31, 0.28)",
                    paddingHorizontal: 10,
                    paddingVertical: 9,
                  }}
                >
                  <Text
                    style={{
                      color: active ? colors.primary : colors.muted,
                      fontSize: 10,
                      fontWeight: "900",
                      textTransform: "uppercase",
                    }}
                  >
                    {phase.label}
                  </Text>
                  <Text
                    style={{
                      marginTop: 4,
                      color: colors.text,
                      fontSize: 11,
                      lineHeight: 16,
                      fontWeight: "700",
                    }}
                  >
                    {phase.cue}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>
      ) : null}
    </View>
  );
}
