import React from "react";
import { Text, TouchableOpacity, View } from "react-native";
import { commonStyles } from "../theme/styles";
import { colors } from "../theme/colors";

export default function ModeCard({ title, description, tag = "Drill", onPress }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.9}
      style={[
        commonStyles.card,
        {
          borderColor: "#34597e",
          backgroundColor: colors.cardElevated,
          overflow: "hidden",
        },
      ]}
    >
      <View
        style={{
          position: "absolute",
          right: -28,
          top: -24,
          width: 120,
          height: 120,
          borderRadius: 60,
          backgroundColor: "rgba(255, 122, 26, 0.12)",
        }}
      />
      <View
        style={{
          width: 54,
          height: 6,
          borderRadius: 999,
          backgroundColor: colors.primary,
          marginBottom: 14,
        }}
      />
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 20, fontWeight: "800", color: colors.text }}>{title}</Text>
          <Text style={{ marginTop: 8, color: colors.muted, lineHeight: 20 }}>{description}</Text>
        </View>
        <View
          style={{
            paddingHorizontal: 10,
            paddingVertical: 7,
            borderRadius: 999,
            backgroundColor: "rgba(110, 203, 255, 0.12)",
            borderWidth: 1,
            borderColor: "rgba(110, 203, 255, 0.28)",
          }}
        >
          <Text style={{ color: colors.secondary, fontSize: 11, fontWeight: "800", letterSpacing: 1 }}>
            {tag.toUpperCase()}
          </Text>
        </View>
      </View>
      <Text style={{ marginTop: 16, color: colors.accent, fontWeight: "800", letterSpacing: 0.8 }}>ENTER MODE</Text>
      <View
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 5,
          backgroundColor: colors.primary,
        }}
      />
    </TouchableOpacity>
  );
}
