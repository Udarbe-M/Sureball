import { Feather } from "@expo/vector-icons";
import React, { useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import BrandMark from "../components/BrandMark";
import { DATA_PRIVACY_CONSENT_COPY } from "../constants/privacy";
import { useAuth } from "../context/AuthContext";
import { colors } from "../theme/colors";

export default function DataPrivacyConsentScreen() {
  const { acceptDataPrivacyConsent, signOut } = useAuth();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function handleAccept() {
    if (saving) {
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      await acceptDataPrivacyConsent();
    } catch (error) {
      setMessage(String(error.message || error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.brandRow}>
        <BrandMark size={62} />
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>Data Privacy</Text>
          <Text style={styles.title}>Video Consent</Text>
        </View>
      </View>

      <View style={styles.panel}>
        <View style={styles.iconWrap}>
          <Feather name="shield" size={26} color={colors.primary} />
        </View>
        {DATA_PRIVACY_CONSENT_COPY.map((item) => (
          <Text key={item} style={styles.copy}>
            {item}
          </Text>
        ))}
      </View>

      {message ? <Text style={styles.errorText}>{message}</Text> : null}

      <TouchableOpacity
        activeOpacity={0.9}
        onPress={handleAccept}
        disabled={saving}
        style={[styles.primaryButton, saving && { opacity: 0.7 }]}
      >
        {saving ? <ActivityIndicator color="#091220" /> : <Text style={styles.primaryButtonText}>I Agree and Continue</Text>}
      </TouchableOpacity>

      <TouchableOpacity activeOpacity={0.85} onPress={signOut} disabled={saving} style={styles.secondaryButton}>
        <Text style={styles.secondaryButtonText}>Sign out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 22,
    paddingVertical: 42,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  eyebrow: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  title: {
    marginTop: 4,
    color: colors.text,
    fontSize: 32,
    fontWeight: "900",
  },
  panel: {
    marginTop: 24,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 18,
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 122, 26, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(255, 122, 26, 0.28)",
  },
  copy: {
    marginTop: 14,
    color: colors.text,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "700",
  },
  errorText: {
    marginTop: 14,
    color: colors.danger,
    fontSize: 13,
    lineHeight: 18,
  },
  primaryButton: {
    marginTop: 20,
    borderRadius: 999,
    backgroundColor: colors.primary,
    minHeight: 54,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  primaryButtonText: {
    color: "#091220",
    fontSize: 15,
    fontWeight: "900",
  },
  secondaryButton: {
    marginTop: 12,
    alignItems: "center",
    paddingVertical: 12,
  },
  secondaryButtonText: {
    color: colors.muted,
    fontWeight: "900",
  },
});
