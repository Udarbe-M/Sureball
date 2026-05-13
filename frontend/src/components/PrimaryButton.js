import React from "react";
import { ActivityIndicator, Text, TouchableOpacity } from "react-native";
import { commonStyles } from "../theme/styles";

export default function PrimaryButton({ title, onPress, loading = false, disabled = false }) {
  const isDisabled = disabled || loading;
  return (
    <TouchableOpacity
      style={[commonStyles.button, { opacity: isDisabled ? 0.7 : 1 }]}
      onPress={onPress}
      disabled={isDisabled}
    >
      {loading ? <ActivityIndicator color="#fff" /> : <Text style={commonStyles.buttonText}>{title}</Text>}
    </TouchableOpacity>
  );
}
