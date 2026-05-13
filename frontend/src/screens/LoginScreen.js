import React, { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { commonStyles } from "../theme/styles";
import PrimaryButton from "../components/PrimaryButton";
import { saveOrUpdateUserProfile } from "../services/supabase";
import { colors } from "../theme/colors";

export default function LoginScreen({ navigation }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function handleLogin() {
    const playerName = name.trim() || "Student Athlete";
    const normalizedEmail = email.trim() || null;

    setSaving(true);
    setMessage("");
    try {
      const profileResult = await saveOrUpdateUserProfile({
        name: playerName,
        email: normalizedEmail,
      });
      navigation.replace("Dashboard", {
        playerName,
        playerEmail: normalizedEmail,
        userProfile: profileResult.user,
        userPersisted: profileResult.persisted,
      });
    } catch (error) {
      setMessage(String(error.message || error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={[commonStyles.screen, { justifyContent: "center" }]}>
      <View style={commonStyles.card}>
        <Text style={commonStyles.title}>SureBall</Text>
        <Text style={commonStyles.subtitle}>Basketball coaching prototype powered by pose and ball detection.</Text>
        <Text style={[commonStyles.label, { marginTop: 16 }]}>Player Name</Text>
        <TextInput
          style={commonStyles.input}
          placeholder="Enter your name"
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
        />
        <Text style={[commonStyles.label, { marginTop: 14 }]}>Email (Optional)</Text>
        <TextInput
          style={commonStyles.input}
          placeholder="Enter your email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        {message ? (
          <Text style={{ marginTop: 10, color: colors.danger, fontSize: 13 }}>
            {message}
          </Text>
        ) : null}
        <PrimaryButton title="Login" onPress={handleLogin} loading={saving} />
      </View>
    </View>
  );
}
