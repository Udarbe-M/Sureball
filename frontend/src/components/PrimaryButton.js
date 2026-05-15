import React from "react";
import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";
import { commonStyles } from "../theme/styles";

export default function PrimaryButton({ title, onPress, loading = false, disabled = false }) {
  const isDisabled = disabled || loading;
  return (
    <TouchableOpacity
      style={[commonStyles.button, { opacity: isDisabled ? 0.7 : 1 }]}
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.88}
    >
      {loading ? (
        <ActivityIndicator color="#091220" />
      ) : (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={commonStyles.buttonText}>{title}</Text>
          <Text style={[commonStyles.buttonText, { opacity: 0.72 }]}>GO</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}
