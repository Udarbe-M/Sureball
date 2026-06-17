import React, { useEffect, useMemo, useState } from "react";
import { Feather } from "@expo/vector-icons";
import { Alert, ScrollView, Switch, Text, TouchableOpacity, View } from "react-native";
import { DATA_PRIVACY_CONSENT_COPY, DATA_PRIVACY_CONSENT_VERSION } from "../constants/privacy";
import { useAuth } from "../context/AuthContext";
import { healthCheck } from "../services/api";
import {
  RECORDING_COUNTDOWN_OPTIONS,
  SESSION_HISTORY_LIMIT_OPTIONS,
  clearSavedSessionVideos,
  formatStorageBytes,
  getAutoSaveVideosPreference,
  getRecordingCountdownSecondsPreference,
  getRecordingCountdownSoundPreference,
  getSessionHistoryLimitPreference,
  getSessionStorageStats,
  setAutoSaveVideosPreference,
  setRecordingCountdownSecondsPreference,
  setRecordingCountdownSoundPreference,
  setSessionHistoryLimitPreference,
} from "../services/storage";
import { colors } from "../theme/colors";
import { commonStyles } from "../theme/styles";
import { buildUserKey } from "../utils/userKey";

export default function SettingsScreen({ navigation }) {
  const { isGuest, playerEmail, playerName, profile, userId } = useAuth();
  const userPersisted = Boolean(profile?.id) && !isGuest;
  const consentAccepted = Boolean(
    profile?.data_privacy_consent_accepted &&
      profile?.data_privacy_consent_version === DATA_PRIVACY_CONSENT_VERSION
  );
  const consentAcceptedAt = formatConsentDate(profile?.data_privacy_consent_accepted_at);
  const consentStorageLabel = isGuest ? "Stored locally on this device" : "Stored in your Supabase profile";
  const userKey = useMemo(
    () => buildUserKey({ userId, playerName, playerEmail }),
    [playerEmail, playerName, userId]
  );
  const [autoSaveVideos, setAutoSaveVideos] = useState(true);
  const [savingAutoSave, setSavingAutoSave] = useState(false);
  const [historyLimit, setHistoryLimit] = useState(100);
  const [savingHistoryLimit, setSavingHistoryLimit] = useState(false);
  const [recordingCountdownSeconds, setRecordingCountdownSeconds] = useState(3);
  const [recordingCountdownSound, setRecordingCountdownSound] = useState(true);
  const [savingCountdown, setSavingCountdown] = useState(false);
  const [savingCountdownSound, setSavingCountdownSound] = useState(false);
  const [storageStats, setStorageStats] = useState({ bytes: 0, savedVideoCount: 0, sessionCount: 0 });
  const [storageMessage, setStorageMessage] = useState("");
  const [storageMessageTone, setStorageMessageTone] = useState("neutral");
  const [clearingVideos, setClearingVideos] = useState(false);
  const [backendStatus, setBackendStatus] = useState("Checking...");

  useEffect(() => {
    let mounted = true;
    healthCheck()
      .then(() => {
        if (mounted) {
          setBackendStatus("Connected");
        }
      })
      .catch(() => {
        if (mounted) {
          setBackendStatus("Offline");
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    Promise.all([
      getAutoSaveVideosPreference(userKey),
      getSessionHistoryLimitPreference(userKey),
      getSessionStorageStats(userKey),
      getRecordingCountdownSecondsPreference(userKey),
      getRecordingCountdownSoundPreference(userKey),
    ])
      .then(([enabled, limit, stats, countdownSeconds, countdownSound]) => {
        if (mounted) {
          setAutoSaveVideos(enabled);
          setHistoryLimit(limit);
          setStorageStats(stats);
          setRecordingCountdownSeconds(countdownSeconds);
          setRecordingCountdownSound(countdownSound);
        }
      })
      .catch(() => {
        if (mounted) {
          setAutoSaveVideos(true);
        }
      });
    return () => {
      mounted = false;
    };
  }, [userKey]);

  async function refreshStorageStats() {
    const stats = await getSessionStorageStats(userKey);
    setStorageStats(stats);
  }

  async function handleAutoSaveToggle(enabled) {
    const previousValue = autoSaveVideos;
    setAutoSaveVideos(enabled);
    setSavingAutoSave(true);

    try {
      await setAutoSaveVideosPreference(userKey, enabled);
      setStorageMessageTone("success");
      setStorageMessage(enabled ? "Automatic video saving is enabled." : "Automatic video saving is disabled.");
    } catch (error) {
      setAutoSaveVideos(previousValue);
      Alert.alert("Setting not saved", String(error.message || error));
    } finally {
      setSavingAutoSave(false);
    }
  }

  async function handleHistoryLimitChange(limit) {
    if (savingHistoryLimit || Number(limit) === Number(historyLimit)) {
      return;
    }

    const previousLimit = historyLimit;
    setHistoryLimit(limit);
    setSavingHistoryLimit(true);
    setStorageMessage("");

    try {
      const normalizedLimit = await setSessionHistoryLimitPreference(userKey, limit);
      setHistoryLimit(normalizedLimit);
      await refreshStorageStats();
      setStorageMessageTone("success");
      setStorageMessage(`Session History will keep the latest ${normalizedLimit} sessions.`);
    } catch (error) {
      setHistoryLimit(previousLimit);
      Alert.alert("Setting not saved", String(error.message || error));
    } finally {
      setSavingHistoryLimit(false);
    }
  }

  async function handleCountdownChange(seconds) {
    if (savingCountdown || Number(seconds) === Number(recordingCountdownSeconds)) {
      return;
    }

    const previousSeconds = recordingCountdownSeconds;
    setRecordingCountdownSeconds(seconds);
    setSavingCountdown(true);
    setStorageMessage("");

    try {
      const normalizedSeconds = await setRecordingCountdownSecondsPreference(userKey, seconds);
      setRecordingCountdownSeconds(normalizedSeconds);
      setStorageMessageTone("success");
      setStorageMessage(
        normalizedSeconds > 0
          ? `Recording countdown set to ${normalizedSeconds} seconds.`
          : "Recording countdown is turned off."
      );
    } catch (error) {
      setRecordingCountdownSeconds(previousSeconds);
      Alert.alert("Setting not saved", String(error.message || error));
    } finally {
      setSavingCountdown(false);
    }
  }

  async function handleCountdownSoundToggle(enabled) {
    const previousValue = recordingCountdownSound;
    setRecordingCountdownSound(enabled);
    setSavingCountdownSound(true);
    setStorageMessage("");

    try {
      await setRecordingCountdownSoundPreference(userKey, enabled);
      setStorageMessageTone("success");
      setStorageMessage(enabled ? "Countdown sound is enabled." : "Countdown sound is muted.");
    } catch (error) {
      setRecordingCountdownSound(previousValue);
      Alert.alert("Setting not saved", String(error.message || error));
    } finally {
      setSavingCountdownSound(false);
    }
  }

  function handleClearSavedVideos() {
    if (!storageStats.savedVideoCount || clearingVideos) {
      return;
    }

    Alert.alert(
      "Delete saved videos?",
      "This removes local annotated video files from storage. Session History records and analysis summaries stay available.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete Videos",
          style: "destructive",
          onPress: async () => {
            setClearingVideos(true);
            setStorageMessage("");
            try {
              const result = await clearSavedSessionVideos(userKey);
              await refreshStorageStats();
              setStorageMessageTone("success");
              setStorageMessage(`${result.deletedVideoCount} saved video file${result.deletedVideoCount === 1 ? "" : "s"} removed.`);
            } catch (error) {
              Alert.alert("Videos not deleted", String(error.message || error));
            } finally {
              setClearingVideos(false);
            }
          },
        },
      ]
    );
  }

  return (
    <ScrollView style={commonStyles.screen} contentContainerStyle={commonStyles.screenBottomSpace}>
      <View style={commonStyles.heroCard}>
        <Text style={commonStyles.eyebrow}>Settings</Text>
        <Text style={[commonStyles.title, { marginTop: 10 }]}>App Preferences</Text>
        <Text style={commonStyles.subtitle}>Manage storage, system status, and training app behavior.</Text>
      </View>

      <View style={commonStyles.card}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 14 }}>
          <View style={{ flex: 1 }}>
            <Text style={commonStyles.label}>Data Privacy</Text>
            <Text style={[commonStyles.sectionTitle, { marginTop: 10 }]}>Video Processing Consent</Text>
            <Text style={commonStyles.subtitle}>
              {DATA_PRIVACY_CONSENT_COPY[0]}
            </Text>
          </View>
          <View
            style={{
              width: 44,
              height: 44,
              borderRadius: 22,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: consentAccepted ? "rgba(56, 211, 159, 0.12)" : "rgba(255, 200, 87, 0.12)",
              borderWidth: 1,
              borderColor: consentAccepted ? "rgba(56, 211, 159, 0.34)" : "rgba(255, 200, 87, 0.34)",
            }}
          >
            <Feather name={consentAccepted ? "shield" : "alert-triangle"} size={21} color={consentAccepted ? colors.success : colors.warning} />
          </View>
        </View>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 14 }}>
          <StatusPill
            label={consentAccepted ? "Accepted" : "Needs Consent"}
            color={consentAccepted ? colors.success : colors.warning}
          />
          <StatusPill label={profile?.data_privacy_consent_version || "No Version"} color={colors.secondary} />
        </View>

        <View style={{ marginTop: 14, gap: 10 }}>
          <ConsentDetailRow label="Accepted" value={consentAcceptedAt} />
          <ConsentDetailRow label="Profile Type" value={isGuest ? "Guest profile" : "Signed-in account"} />
          <ConsentDetailRow label="Consent Record" value={consentStorageLabel} />
        </View>

        <Text style={[commonStyles.subtitle, { marginTop: 14 }]}>
          This consent allows SureBall to process recorded or uploaded basketball videos for coaching feedback,
          annotated videos, scores, and session history.
        </Text>
      </View>

      <View style={commonStyles.card}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 14 }}>
          <View style={{ flex: 1 }}>
            <Text style={commonStyles.label}>Storage</Text>
            <Text style={[commonStyles.sectionTitle, { marginTop: 10 }]}>Auto-save Session Videos</Text>
            <Text style={commonStyles.subtitle}>
              Save annotated analysis videos locally for offline playback in Session History.
            </Text>
          </View>
          <Switch
            value={autoSaveVideos}
            onValueChange={handleAutoSaveToggle}
            thumbColor="#ffffff"
            trackColor={{ false: colors.border, true: colors.primary }}
            disabled={savingAutoSave}
          />
        </View>
        <Text
          style={[
            commonStyles.subtitle,
            { marginTop: 12, color: autoSaveVideos ? colors.success : colors.warning },
          ]}
        >
          {autoSaveVideos
            ? "Automatic local video saving is enabled."
            : "Session records will save without storing annotated video files."}
        </Text>
      </View>

      <View style={commonStyles.card}>
        <Text style={commonStyles.label}>Storage Used</Text>
        <Text style={[commonStyles.sectionTitle, { marginTop: 10 }]}>Saved Session Videos</Text>
        <Text style={commonStyles.subtitle}>
          Local videos can be cleared without deleting scores, feedback, or session summaries.
        </Text>

        <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
          <SettingsMetric label="Video Storage" value={formatStorageBytes(storageStats.bytes)} color={colors.primary} />
          <SettingsMetric label="Saved Videos" value={storageStats.savedVideoCount} color={colors.secondary} />
        </View>

        <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
          <SettingsMetric label="Sessions" value={storageStats.sessionCount} color={colors.success} />
          <SettingsMetric label="Limit" value={historyLimit} color={colors.warning} />
        </View>

        <TouchableOpacity
          activeOpacity={0.9}
          onPress={handleClearSavedVideos}
          disabled={!storageStats.savedVideoCount || clearingVideos}
          style={[
            commonStyles.button,
            {
              backgroundColor: "rgba(255, 123, 123, 0.16)",
              borderColor: colors.danger,
              opacity: !storageStats.savedVideoCount || clearingVideos ? 0.55 : 1,
              shadowColor: "transparent",
            },
          ]}
        >
          <Text style={[commonStyles.buttonText, { color: colors.danger }]}>
            {clearingVideos ? "Deleting Videos..." : "Delete Saved Videos"}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={commonStyles.card}>
        <Text style={commonStyles.label}>Session History</Text>
        <Text style={[commonStyles.sectionTitle, { marginTop: 10 }]}>Keep Recent Sessions</Text>
        <Text style={commonStyles.subtitle}>
          Lowering the limit trims older session records and removes their saved local videos.
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 14 }}>
          {SESSION_HISTORY_LIMIT_OPTIONS.map((limit) => {
            const active = Number(historyLimit) === Number(limit);
            return (
              <TouchableOpacity
                key={limit}
                activeOpacity={0.9}
                onPress={() => handleHistoryLimitChange(limit)}
                disabled={savingHistoryLimit}
                style={{
                  minWidth: 68,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: active ? colors.primary : colors.border,
                  backgroundColor: active ? colors.primary : colors.backgroundSoft,
                  paddingHorizontal: 14,
                  paddingVertical: 11,
                  alignItems: "center",
                  opacity: savingHistoryLimit ? 0.65 : 1,
                }}
              >
                <Text style={{ color: active ? "#091220" : colors.text, fontSize: 13, fontWeight: "900" }}>{limit}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <View style={commonStyles.card}>
        <Text style={commonStyles.label}>Recording Countdown</Text>
        <Text style={[commonStyles.sectionTitle, { marginTop: 10 }]}>Start Delay</Text>
        <Text style={commonStyles.subtitle}>
          Give the player time to get into position before the recording and scoring clip starts.
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 14 }}>
          {RECORDING_COUNTDOWN_OPTIONS.map((seconds) => {
            const active = Number(recordingCountdownSeconds) === Number(seconds);
            return (
              <TouchableOpacity
                key={seconds}
                activeOpacity={0.9}
                onPress={() => handleCountdownChange(seconds)}
                disabled={savingCountdown}
                style={{
                  minWidth: 68,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: active ? colors.primary : colors.border,
                  backgroundColor: active ? colors.primary : colors.backgroundSoft,
                  paddingHorizontal: 14,
                  paddingVertical: 11,
                  alignItems: "center",
                  opacity: savingCountdown ? 0.65 : 1,
                }}
              >
                <Text style={{ color: active ? "#091220" : colors.text, fontSize: 13, fontWeight: "900" }}>
                  {seconds === 0 ? "Off" : `${seconds}s`}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <View style={{ marginTop: 18, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 14 }}>
          <View style={{ flex: 1 }}>
            <Text style={[commonStyles.sectionTitle, { fontSize: 16 }]}>Countdown Sound</Text>
            <Text style={commonStyles.subtitle}>Play a short cue on each countdown number.</Text>
          </View>
          <Switch
            value={recordingCountdownSound}
            onValueChange={handleCountdownSoundToggle}
            thumbColor="#ffffff"
            trackColor={{ false: colors.border, true: colors.primary }}
            disabled={savingCountdownSound}
          />
        </View>
      </View>

      {storageMessage ? (
        <Text
          style={{
            color: storageMessageTone === "success" ? colors.success : colors.warning,
            fontSize: 13,
            lineHeight: 18,
            paddingHorizontal: 4,
          }}
        >
          {storageMessage}
        </Text>
      ) : null}

      <View style={commonStyles.card}>
        <Text style={commonStyles.label}>System Status</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 14 }}>
          <StatusPill
            label={`Backend ${backendStatus}`}
            color={backendStatus === "Connected" ? colors.success : backendStatus === "Offline" ? colors.danger : colors.warning}
          />
          <StatusPill
            label={isGuest ? "Guest Profile" : userPersisted ? "Supabase Profile" : "Profile Pending"}
            color={isGuest ? colors.accent : userPersisted ? colors.secondary : colors.warning}
          />
        </View>
      </View>

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
    </ScrollView>
  );
}

function formatConsentDate(value) {
  if (!value) {
    return "Not recorded";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Not recorded";
  }
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function ConsentDetailRow({ label, value }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
      <Text style={{ color: colors.muted, fontSize: 12, fontWeight: "800", textTransform: "uppercase", flex: 0.42 }}>
        {label}
      </Text>
      <Text style={{ color: colors.text, fontSize: 13, lineHeight: 18, fontWeight: "800", textAlign: "right", flex: 0.58 }}>
        {value}
      </Text>
    </View>
  );
}

function SettingsMetric({ label, value, color }) {
  return (
    <View
      style={{
        flex: 1,
        minHeight: 82,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.cardElevated,
        padding: 13,
      }}
    >
      <Text style={{ color: colors.muted, fontSize: 9, fontWeight: "900", textTransform: "uppercase" }}>{label}</Text>
      <Text style={{ marginTop: 8, color, fontSize: 18, fontWeight: "900" }}>{value}</Text>
    </View>
  );
}

function StatusPill({ label, color }) {
  return (
    <View
      style={[
        commonStyles.pill,
        {
          backgroundColor: "rgba(7, 17, 31, 0.28)",
          borderColor: color,
        },
      ]}
    >
      <Text style={[commonStyles.pillText, { color }]}>{label}</Text>
    </View>
  );
}
