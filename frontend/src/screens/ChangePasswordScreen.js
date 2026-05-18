import React, { useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import PrimaryButton from "../components/PrimaryButton";
import { useAuth } from "../context/AuthContext";
import { colors } from "../theme/colors";
import { commonStyles } from "../theme/styles";

export default function ChangePasswordScreen() {
  const { changePassword, isGuest } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState("neutral");

  async function handleSave() {
    if (isGuest) {
      setMessageTone("error");
      setMessage("Guest users do not have a password to change.");
      return;
    }

    if (newPassword.length < 6) {
      setMessageTone("error");
      setMessage("New password must be at least 6 characters.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setMessageTone("error");
      setMessage("New password and confirmation do not match.");
      return;
    }

    setSaving(true);
    setMessage("");
    try {
      await changePassword({
        currentPassword,
        newPassword,
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setMessageTone("success");
      setMessage("Password updated successfully.");
    } catch (error) {
      setMessageTone("error");
      setMessage(String(error.message || error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView style={commonStyles.screen} contentContainerStyle={commonStyles.screenBottomSpace}>
      <View style={commonStyles.heroCard}>
        <Text style={commonStyles.eyebrow}>Security</Text>
        <Text style={[commonStyles.title, { marginTop: 10 }]}>Change Password</Text>
        <Text style={commonStyles.subtitle}>
          Update your account password without leaving the app. Guest users can skip this because their profile is local only.
        </Text>
      </View>

      <View style={commonStyles.card}>
        <Text style={commonStyles.label}>Current Password</Text>
        <TextInput
          style={[commonStyles.input, { marginTop: 8 }]}
          placeholder="Enter your current password"
          placeholderTextColor={colors.muted}
          value={currentPassword}
          onChangeText={setCurrentPassword}
          secureTextEntry
          autoCapitalize="none"
          editable={!saving && !isGuest}
        />

        <Text style={[commonStyles.label, { marginTop: 16 }]}>New Password</Text>
        <TextInput
          style={[commonStyles.input, { marginTop: 8 }]}
          placeholder="Enter a new password"
          placeholderTextColor={colors.muted}
          value={newPassword}
          onChangeText={setNewPassword}
          secureTextEntry
          autoCapitalize="none"
          editable={!saving && !isGuest}
        />

        <Text style={[commonStyles.label, { marginTop: 16 }]}>Confirm New Password</Text>
        <TextInput
          style={[commonStyles.input, { marginTop: 8 }]}
          placeholder="Confirm your new password"
          placeholderTextColor={colors.muted}
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          secureTextEntry
          autoCapitalize="none"
          editable={!saving && !isGuest}
        />

        {message ? (
          <Text
            style={{
              marginTop: 12,
              color: messageTone === "success" ? colors.success : colors.danger,
              fontSize: 13,
            }}
          >
            {message}
          </Text>
        ) : null}

        <PrimaryButton
          title="Update Password"
          onPress={handleSave}
          loading={saving}
          disabled={isGuest}
        />
      </View>
    </ScrollView>
  );
}
