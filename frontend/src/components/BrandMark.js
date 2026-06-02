import React from "react";
import { Image } from "react-native";

export default function BrandMark({ size = 40, style }) {
  return (
    <Image
      source={require("../../assets/brand-mark.png")}
      style={[{ width: size, height: size }, style]}
      resizeMode="contain"
    />
  );
}
