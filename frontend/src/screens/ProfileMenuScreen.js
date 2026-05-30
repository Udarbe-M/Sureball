import React, { useEffect, useState } from "react";
import { Alert, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import PrimaryButton from "../components/PrimaryButton";
import { useAuth } from "../context/AuthContext";
import { normalizePlayerName } from "../services/supabase";
import { colors } from "../theme/colors";
import { commonStyles } from "../theme/styles";

export default function ProfileMenuScreen({ navigation }) {
  const { isGuest, playerEmail, playerName, signOut, updatePlayerName } = useAuth();
  const [draftName, setDraftName] = useState(playerName);
  const [saving, setSaving] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState("neutral");

  useEffect(() => {
    setDraftName(playerName);
  }, [playerName]);

  async function handleSave() {
    const trimmedName = normalizePlayerName(draftName);
    setSaving(true);
    setMessage("");

    try {
      await updatePlayerName(trimmedName);
      setDraftName(trimmedName);
      setMessageTone("success");
      setMessage("Player name updated.");
    } catch (error) {
      setMessageTone("error");
      setMessage(String(error.message || error));
    } finally {
      setSaving(false);
    }
  }

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOut();
    } catch (error) {
      Alert.alert("Sign out failed", String(error.message || error));
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <ScrollView style={commonStyles.screen} contentContainerStyle={commonStyles.screenBottomSpace}>
      <View style={commonStyles.heroCard}>
        <Text style={commonStyles.eyebrow}>Profile</Text>
        <Text style={[commonStyles.title, { marginTop: 10 }]}>Account & Identity</Text>
        <Text style={commonStyles.subtitle}>
          Manage your account details, athlete identity, and sign-in controls.
        </Text>
      </View>

      <View style={commonStyles.card}>
        <Text style={commonStyles.label}>Account Details</Text>
        <Text style={[commonStyles.sectionTitle, { marginTop: 10 }]}>
          {isGuest ? "Guest User" : playerEmail || "No email found"}
        </Text>
        <Text style={commonStyles.subtitle}>
          {isGuest
            ? "This guest profile is stored locally on this device."
            : "This is the athlete email currently linked to your SureBall account."}
        </Text>
        <Text style={[commonStyles.subtitle, { marginTop: 12, color: colors.text }]}>Player name: {playerName}</Text>
      </View>

      <View style={commonStyles.card}>
        <Text style={commonStyles.label}>Player Name</Text>
        <Text style={commonStyles.subtitle}>
          {isGuest
            ? "This guest player name is stored locally and is used throughout the training screens."
            : "This name is stored in your Supabase profile and is used throughout the training screens."}
        </Text>
        <TextInput
          style={[commonStyles.input, { marginTop: 14 }]}
          placeholder="Enter your player name"
          placeholderTextColor={colors.muted}
          value={draftName}
          onChangeText={setDraftName}
          autoCapitalize="words"
          editable={!saving && !signingOut}
        />

        {message ? (
          <Text
            style={{
              marginTop: 10,
              color: messageTone === "success" ? colors.success : colors.danger,
              fontSize: 13,
            }}
          >
            {message}
          </Text>
        ) : null}

        <PrimaryButton
          title="Save Player Name"
          onPress={handleSave}
          loading={saving}
          disabled={normalizePlayerName(draftName) === normalizePlayerName(playerName) || signingOut}
        />
      </View>

      <View style={commonStyles.card}>
        <Text style={commonStyles.label}>Session Controls</Text>
        {!isGuest ? (
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => navigation.navigate("ChangePassword")}
            style={[
              commonStyles.button,
              {
                backgroundColor: colors.cardElevated,
                borderColor: colors.secondary,
                shadowColor: "transparent",
              },
            ]}
          >
            <Text style={[commonStyles.buttonText, { color: colors.secondary }]}>Change Password</Text>
          </TouchableOpacity>
        ) : null}

        <TouchableOpacity
          activeOpacity={0.9}
          onPress={() => navigation.goBack()}
          style={[
            commonStyles.button,
            {
              backgroundColor: colors.cardElevated,
              borderColor: colors.border,
              shadowColor: "transparent",
            },
          ]}
        >
          <Text style={[commonStyles.buttonText, { color: colors.text }]}>Back To Camera</Text>
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.9}
          onPress={handleSignOut}
          disabled={signingOut || saving}
          style={[
            commonStyles.button,
            {
              backgroundColor: "rgba(255, 123, 123, 0.16)",
              borderColor: colors.danger,
              shadowColor: "transparent",
              opacity: signingOut ? 0.7 : 1,
            },
          ]}
        >
          <Text style={[commonStyles.buttonText, { color: colors.danger }]}>
            {signingOut ? "Signing Out..." : "Sign Out"}
          </Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}
