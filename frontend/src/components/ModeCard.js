import React from "react";
import { Text, TouchableOpacity, View } from "react-native";
import { commonStyles } from "../theme/styles";
import { colors } from "../theme/colors";

export default function ModeCard({ title, description, onPress }) {
  return (
    <TouchableOpacity onPress={onPress} style={[commonStyles.card, { borderLeftWidth: 5, borderLeftColor: colors.primary }]}>
      <View>
        <Text style={{ fontSize: 18, fontWeight: "700", color: colors.text }}>{title}</Text>
        <Text style={{ marginTop: 6, color: colors.muted }}>{description}</Text>
      </View>
    </TouchableOpacity>
  );
}
