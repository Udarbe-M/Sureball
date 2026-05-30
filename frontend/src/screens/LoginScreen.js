import React, { useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useAuth } from "../context/AuthContext";
import { isSupabaseReady, normalizePlayerName } from "../services/supabase";
import { colors } from "../theme/colors";

export default function LoginScreen() {
  const [authMode, setAuthMode] = useState("login");
  const [registerMode, setRegisterMode] = useState("account");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [resendingVerification, setResendingVerification] = useState(false);
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState("");
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState("neutral");
  const scrollViewRef = useRef(null);
  const formCardRef = useRef(null);
  const nameFieldRef = useRef(null);
  const emailFieldRef = useRef(null);
  const passwordFieldRef = useRef(null);
  const { clearError, resendVerificationEmail, signIn, signUp } = useAuth();

  function scrollToField(fieldRef) {
    requestAnimationFrame(() => {
      if (!fieldRef?.current || !formCardRef.current || !scrollViewRef.current) {
        return;
      }

      fieldRef.current.measureLayout(
        formCardRef.current,
        (_left, top) => {
          scrollViewRef.current?.scrollTo({
            y: Math.max(0, top - 24),
            animated: true,
          });
        },
        () => {}
      );
    });
  }

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
      setPendingVerificationEmail("");
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
    setPendingVerificationEmail("");
    clearError();

    try {
      if (authMode === "register") {
        const result = await signUp({
          email: normalizedEmail,
          password: normalizedPassword,
          playerName: normalizedName,
        });

        if (result.needsEmailVerification) {
          setPendingVerificationEmail(normalizedEmail);
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

  async function handleResendVerification() {
    const normalizedEmail = String(pendingVerificationEmail || email || "").trim().toLowerCase();
    if (!normalizedEmail) {
      setMessageTone("error");
      setMessage("Enter the email address that should receive the verification email first.");
      return;
    }

    setResendingVerification(true);
    setMessage("");
    clearError();

    try {
      await resendVerificationEmail(normalizedEmail);
      setPendingVerificationEmail(normalizedEmail);
      setMessageTone("success");
      setMessage("A new verification email was requested. Check your inbox and spam folder.");
    } catch (error) {
      setMessageTone("error");
      setMessage(String(error.message || error));
    } finally {
      setResendingVerification(false);
    }
  }

  const actionDisabled = (authMode === "login" || registerMode === "account") && !isSupabaseReady();

  return (
    <View style={authStyles.screen}>
      <KeyboardAvoidingView style={{ flex: 1, width: "100%" }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <ScrollView
          ref={scrollViewRef}
          style={{ flex: 1 }}
          contentContainerStyle={authStyles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
          <View style={authStyles.brandBlock}>
            <View style={authStyles.logoMark}>
              <Text style={authStyles.logoText}>SB</Text>
            </View>
            <Text style={authStyles.brandName}>SureBall</Text>
            <Text style={authStyles.brandCopy}>Camera-first basketball coaching.</Text>
          </View>

          <View ref={formCardRef} style={authStyles.sheet}>
            <Text style={authStyles.sheetEyebrow}>Account</Text>
            <Text style={authStyles.sheetTitle}>{authMode === "login" ? "Sign in" : "Sign up"}</Text>
            <Text style={authStyles.sheetCopy}>
              {authMode === "login"
                ? "Open the camera, record a clip, and get coaching feedback."
                : registerMode === "guest"
                  ? "Create a local guest profile and start recording right away."
                  : "Create your player account, then use the camera coaching flow."}
            </Text>

            <View style={authStyles.toggleRow}>
              <ModeToggle
                active={authMode === "login"}
                label="Sign in"
                onPress={() => {
                  setAuthMode("login");
                  setMessage("");
                  setPendingVerificationEmail("");
                }}
              />
              <ModeToggle
                active={authMode === "register"}
                label="Sign up"
                onPress={() => {
                  setAuthMode("register");
                  setMessage("");
                }}
              />
            </View>

            {authMode === "register" ? (
              <View style={authStyles.toggleRow}>
                <ModeToggle
                  active={registerMode === "account"}
                  label="Email"
                  onPress={() => {
                    setRegisterMode("account");
                    setMessage("");
                  }}
                />
                <ModeToggle
                  active={registerMode === "guest"}
                  label="Guest"
                  onPress={() => {
                    setRegisterMode("guest");
                    setMessage("");
                    setPendingVerificationEmail("");
                  }}
                />
              </View>
            ) : null}

            {authMode === "register" ? (
              <View ref={nameFieldRef}>
                <Text style={authStyles.label}>Player Name</Text>
                <TextInput
                  style={authStyles.input}
                  placeholder="Enter your player name"
                  placeholderTextColor={colors.muted}
                  value={name}
                  onChangeText={setName}
                  autoCapitalize="words"
                  editable={!saving}
                  returnKeyType={registerMode === "guest" ? "done" : "next"}
                  onFocus={() => scrollToField(nameFieldRef)}
                />
              </View>
            ) : null}

            {authMode === "login" || registerMode === "account" ? (
              <>
                <View ref={emailFieldRef}>
                  <Text style={authStyles.label}>Email</Text>
                  <TextInput
                    style={authStyles.input}
                    placeholder="email@address.com"
                    placeholderTextColor={colors.muted}
                    value={email}
                    onChangeText={setEmail}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    editable={!saving}
                    returnKeyType="next"
                    onFocus={() => scrollToField(emailFieldRef)}
                  />
                </View>

                <View ref={passwordFieldRef}>
                  <Text style={authStyles.label}>Password</Text>
                  <TextInput
                    style={authStyles.input}
                    placeholder="Enter your password"
                    placeholderTextColor={colors.muted}
                    value={password}
                    onChangeText={setPassword}
                    autoCapitalize="none"
                    secureTextEntry
                    editable={!saving}
                    returnKeyType="done"
                    onFocus={() => scrollToField(passwordFieldRef)}
                  />
                </View>
              </>
            ) : null}

            {(authMode === "login" || registerMode === "account") && !isSupabaseReady() ? (
              <Text style={authStyles.errorText}>
                Supabase is not configured yet. Add your project URL and publishable key before using email auth.
              </Text>
            ) : null}

            {authMode === "login" ? (
              <Text style={authStyles.smallHint}>Testing locally? Switch to Sign up and choose Guest.</Text>
            ) : null}

            {message ? (
              <Text style={[authStyles.message, { color: messageTone === "success" ? colors.success : colors.danger }]}>
                {message}
              </Text>
            ) : null}

            {pendingVerificationEmail && authMode === "register" && registerMode === "account" ? (
              <TouchableOpacity
                activeOpacity={0.85}
                disabled={resendingVerification || saving}
                onPress={handleResendVerification}
                style={[authStyles.secondaryButton, (resendingVerification || saving) && { opacity: 0.7 }]}
              >
                <Text style={authStyles.secondaryButtonText}>
                  {resendingVerification ? "Sending verification..." : "Resend verification email"}
                </Text>
              </TouchableOpacity>
            ) : null}

            <AuthButton
              title={authMode === "login" ? "Sign in" : registerMode === "guest" ? "Continue as guest" : "Create account"}
              onPress={handleSubmit}
              loading={saving}
              disabled={actionDisabled}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function ModeToggle({ active, label, onPress }) {
  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={onPress}
      style={[authStyles.modeToggle, active && authStyles.modeToggleActive]}
    >
      <Text style={[authStyles.modeToggleText, active && authStyles.modeToggleTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function AuthButton({ title, onPress, loading = false, disabled = false }) {
  const isDisabled = disabled || loading;
  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={onPress}
      disabled={isDisabled}
      style={[authStyles.primaryButton, isDisabled && { opacity: 0.55 }]}
    >
      {loading ? <ActivityIndicator color="#091220" /> : <Text style={authStyles.primaryButtonText}>{title}</Text>}
    </TouchableOpacity>
  );
}

const authStyles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flexGrow: 1,
    justifyContent: "space-between",
    paddingTop: 62,
  },
  brandBlock: {
    alignItems: "center",
    paddingHorizontal: 28,
    paddingBottom: 28,
  },
  logoMark: {
    width: 82,
    height: 82,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.cardElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  logoText: {
    color: colors.primary,
    fontSize: 26,
    fontWeight: "900",
  },
  brandName: {
    marginTop: 22,
    color: colors.text,
    fontSize: 42,
    fontWeight: "900",
  },
  brandCopy: {
    marginTop: 8,
    color: colors.muted,
    fontSize: 15,
    fontWeight: "800",
  },
  sheet: {
    borderTopLeftRadius: 34,
    borderTopRightRadius: 34,
    backgroundColor: colors.card,
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 28,
    minHeight: 460,
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  sheetEyebrow: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  sheetTitle: {
    marginTop: 6,
    color: colors.text,
    fontSize: 30,
    fontWeight: "900",
  },
  sheetCopy: {
    marginTop: 8,
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
  },
  toggleRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 16,
  },
  modeToggle: {
    flex: 1,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.backgroundSoft,
    paddingVertical: 12,
    alignItems: "center",
  },
  modeToggleActive: {
    borderColor: colors.primary,
    backgroundColor: "rgba(255, 122, 26, 0.14)",
  },
  modeToggleText: {
    color: colors.muted,
    fontWeight: "900",
  },
  modeToggleTextActive: {
    color: colors.primary,
  },
  label: {
    marginTop: 16,
    color: colors.text,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  input: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    paddingHorizontal: 15,
    paddingVertical: 14,
    backgroundColor: colors.backgroundSoft,
    color: colors.text,
  },
  smallHint: {
    marginTop: 12,
    color: colors.muted,
    fontSize: 12,
  },
  errorText: {
    marginTop: 12,
    color: colors.danger,
    fontSize: 12,
    lineHeight: 17,
  },
  message: {
    marginTop: 12,
    fontSize: 13,
    lineHeight: 18,
  },
  secondaryButton: {
    marginTop: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.secondary,
    paddingVertical: 11,
    alignItems: "center",
  },
  secondaryButtonText: {
    color: colors.secondary,
    fontWeight: "900",
  },
  primaryButton: {
    marginTop: 18,
    borderRadius: 999,
    backgroundColor: colors.primary,
    paddingVertical: 15,
    alignItems: "center",
  },
  primaryButtonText: {
    color: "#091220",
    fontSize: 15,
    fontWeight: "900",
  },
});
