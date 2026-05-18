import React, { useState } from "react";
import { Text, TextInput, TouchableOpacity, View } from "react-native";
import PrimaryButton from "../components/PrimaryButton";
import { useAuth } from "../context/AuthContext";
import { isSupabaseReady, normalizePlayerName } from "../services/supabase";
import { colors } from "../theme/colors";
import { commonStyles } from "../theme/styles";

export default function LoginScreen() {
  const [authMode, setAuthMode] = useState("login");
  const [registerMode, setRegisterMode] = useState("account");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState("neutral");
  const { clearError, signIn, signUp } = useAuth();

  async function handleSubmit() {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const normalizedPassword = String(password || "");
    const normalizedName = normalizePlayerName(name);
    const isGuestRegistration = authMode === "register" && registerMode === "guest";

    if (authMode === "register" && normalizedName.length < 2) {
      setMessageTone("error");
      setMessage("Enter a player name for the new account.");
      return;
    }

    if (isGuestRegistration) {
      setSaving(true);
      setMessage("");
      clearError();

      try {
        await signUp({
          playerName: normalizedName,
          asGuest: true,
        });
      } catch (error) {
        setMessageTone("error");
        setMessage(String(error.message || error));
      } finally {
        setSaving(false);
      }
      return;
    }

    if (!normalizedEmail) {
      setMessageTone("error");
      setMessage("Email is required.");
      return;
    }

    if (normalizedPassword.length < 6) {
      setMessageTone("error");
      setMessage("Password must be at least 6 characters.");
      return;
    }

    setSaving(true);
    setMessage("");
    clearError();

    try {
      if (authMode === "register") {
        const result = await signUp({
          email: normalizedEmail,
          password: normalizedPassword,
          playerName: normalizedName,
        });

        if (result.needsEmailVerification) {
          setMessageTone("success");
          setMessage("Check your email to confirm the account, then return here to sign in.");
        }
      } else {
        await signIn({
          email: normalizedEmail,
          password: normalizedPassword,
        });
      }
    } catch (error) {
      setMessageTone("error");
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
          Sign in with your player account, or create a guest profile if you just want to test the app quickly.
        </Text>
        <View style={{ flexDirection: "row", gap: 10, marginTop: 18 }}>
          <View style={commonStyles.pill}>
            <Text style={commonStyles.pillText}>Email Auth</Text>
          </View>
          <View style={commonStyles.pill}>
            <Text style={commonStyles.pillText}>Profile Sync</Text>
          </View>
        </View>
      </View>

      <View style={commonStyles.card}>
        <Text style={commonStyles.eyebrow}>Account Access</Text>
        <Text style={[commonStyles.sectionTitle, { marginTop: 10 }]}>
          {authMode === "login" ? "Welcome Back" : "Create Your Player Account"}
        </Text>
        <Text style={commonStyles.subtitle}>
          {authMode === "login"
            ? "Use your registered email and password to open the training dashboard."
            : registerMode === "guest"
              ? "Create a local guest profile with just a player name. No email verification is required."
              : "Register once, verify your email if prompted, and your player profile will be created automatically."}
        </Text>

        <View style={{ flexDirection: "row", gap: 10, marginTop: 18 }}>
          <ModeToggle
            active={authMode === "login"}
            label="Login"
            onPress={() => {
              setAuthMode("login");
              setMessage("");
            }}
          />
          <ModeToggle
            active={authMode === "register"}
            label="Register"
            onPress={() => {
              setAuthMode("register");
              setMessage("");
            }}
          />
        </View>

        {authMode === "register" ? (
          <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
            <ModeToggle
              active={registerMode === "account"}
              label="Email Account"
              onPress={() => {
                setRegisterMode("account");
                setMessage("");
              }}
            />
            <ModeToggle
              active={registerMode === "guest"}
              label="Guest User"
              onPress={() => {
                setRegisterMode("guest");
                setMessage("");
              }}
            />
          </View>
        ) : null}

        {authMode === "register" ? (
          <>
            <Text style={[commonStyles.label, { marginTop: 18 }]}>Player Name</Text>
            <TextInput
              style={commonStyles.input}
              placeholder="Enter your player name"
              placeholderTextColor={colors.muted}
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
              editable={!saving}
            />
          </>
        ) : null}

        {authMode === "login" || registerMode === "account" ? (
          <>
            <Text style={[commonStyles.label, { marginTop: 18 }]}>Email</Text>
            <TextInput
              style={commonStyles.input}
              placeholder="email@address.com"
              placeholderTextColor={colors.muted}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              editable={!saving}
            />

            <Text style={[commonStyles.label, { marginTop: 14 }]}>Password</Text>
            <TextInput
              style={commonStyles.input}
              placeholder="Enter your password"
              placeholderTextColor={colors.muted}
              value={password}
              onChangeText={setPassword}
              autoCapitalize="none"
              secureTextEntry
              editable={!saving}
            />
          </>
        ) : null}

        {(authMode === "login" || registerMode === "account") && !isSupabaseReady() ? (
          <Text style={{ marginTop: 10, color: colors.danger, fontSize: 13 }}>
            Supabase is not configured yet. Add your project URL and publishable key before using login.
          </Text>
        ) : null}

        {authMode === "login" ? (
          <Text style={[commonStyles.subtitle, { fontSize: 12 }]}>
            Want to test without email? Switch to Register and choose `Guest User`.
          </Text>
        ) : null}

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
          title={authMode === "login" ? "Login" : registerMode === "guest" ? "Continue As Guest" : "Register"}
          onPress={handleSubmit}
          loading={saving}
          disabled={(authMode === "login" || registerMode === "account") && !isSupabaseReady()}
        />
      </View>
    </View>
  );
}

function ModeToggle({ active, label, onPress }) {
  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={onPress}
      style={{
        flex: 1,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: active ? colors.primary : colors.border,
        backgroundColor: active ? "rgba(255, 122, 26, 0.12)" : colors.backgroundSoft,
        paddingVertical: 12,
        alignItems: "center",
      }}
    >
      <Text style={{ color: colors.text, fontWeight: "800", letterSpacing: 0.8 }}>{label}</Text>
    </TouchableOpacity>
  );
}
