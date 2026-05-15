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
    <View style={commonStyles.screenCentered}>
      <View
        style={{
          position: "absolute",
          top: 88,
          right: -42,
          width: 180,
          height: 180,
          borderRadius: 90,
          backgroundColor: "rgba(255, 122, 26, 0.14)",
        }}
      />
      <View
        style={{
          position: "absolute",
          bottom: 120,
          left: -70,
          width: 220,
          height: 220,
          borderRadius: 110,
          backgroundColor: "rgba(110, 203, 255, 0.1)",
        }}
      />
      <View style={commonStyles.heroCard}>
        <Text style={commonStyles.eyebrow}>Court Vision</Text>
        <Text style={[commonStyles.title, { marginTop: 10 }]}>SureBall</Text>
        <Text style={commonStyles.subtitle}>
          Step into a sharper basketball training flow with live coaching, shooting analytics, and session review in one place.
        </Text>
        <View style={{ flexDirection: "row", gap: 10, marginTop: 18 }}>
          <View style={commonStyles.pill}>
            <Text style={commonStyles.pillText}>Live Analysis</Text>
          </View>
          <View style={commonStyles.pill}>
            <Text style={commonStyles.pillText}>Shot Tracking</Text>
          </View>
        </View>
      </View>

      <View style={commonStyles.card}>
        <Text style={commonStyles.eyebrow}>Player Entry</Text>
        <Text style={[commonStyles.sectionTitle, { marginTop: 10 }]}>Get Session Ready</Text>
        <Text style={commonStyles.subtitle}>Set your athlete profile before opening the training dashboard.</Text>

        <Text style={[commonStyles.label, { marginTop: 18 }]}>Player Name</Text>
        <TextInput
          style={commonStyles.input}
          placeholder="Enter your name"
          placeholderTextColor={colors.muted}
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
        />
        <Text style={[commonStyles.label, { marginTop: 14 }]}>Email (Optional)</Text>
        <TextInput
          style={commonStyles.input}
          placeholder="Enter your email"
          placeholderTextColor={colors.muted}
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
        <PrimaryButton title="Open Dashboard" onPress={handleLogin} loading={saving} />
      </View>
    </View>
  );
}
