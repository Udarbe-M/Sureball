import { useEvent } from "expo";
import { VideoView, useVideoPlayer } from "expo-video";
import React, { useCallback, useState } from "react";
import { Alert, RefreshControl, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "../context/AuthContext";
import { deleteSessionFromBackend, fetchSessionsFromBackend } from "../services/api";
import { deleteLocalSessionRecord, getLocalSessionHistory } from "../services/storage";
import { colors } from "../theme/colors";
import { commonStyles } from "../theme/styles";
import { humanizeMode } from "../utils/helpers";
import { buildUserKey } from "../utils/userKey";

function mergeHistory(localSessions, backendSessions) {
  const normalizedLocal = localSessions.map((item) => ({
    ...item,
    sourceKey: item.id || `${item.mode}-${item.timestamp}`,
  }));
  const normalizedBackend = backendSessions.map((item) => ({
    id: item.session_id,
    mode: item.mode,
    modeLabel: humanizeMode(item.mode),
    score: item.score,
    classification: item.classification,
    detectedErrors: [],
    timestamp: item.timestamp,
    summary: item.summary,
    sourceKey: item.session_id,
  }));
  const full = [...normalizedLocal, ...normalizedBackend];
  const seen = new Set();
  const deduped = [];
  for (const entry of full) {
    const key = entry.id || `${entry.mode}-${entry.timestamp}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(entry);
  }
  return deduped.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

export default function SessionHistoryScreen() {
  const { playerEmail, playerName, userId } = useAuth();
  const userKey = buildUserKey({ userId, playerName, playerEmail });
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState([]);
  const [deletingKey, setDeletingKey] = useState(null);
  const [previewKey, setPreviewKey] = useState(null);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    try {
      const [localSessions, backendSessions] = await Promise.all([
        getLocalSessionHistory(userKey),
        fetchSessionsFromBackend(userKey),
      ]);
      setHistory(mergeHistory(localSessions, backendSessions));
    } finally {
      setLoading(false);
    }
  }, [userKey]);

  useFocusEffect(
    useCallback(() => {
      loadHistory();
    }, [loadHistory])
  );

  function confirmDelete(item) {
    Alert.alert(
      "Delete session?",
      "This will remove the session from your local history and backend history if it exists.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => handleDelete(item),
        },
      ]
    );
  }

  async function handleDelete(item) {
    const recordKey = item.sourceKey || item.id || `${item.mode}-${item.timestamp}`;
    setDeletingKey(recordKey);
    setPreviewKey((current) => (current === recordKey ? null : current));
    try {
      await deleteLocalSessionRecord(userKey, item.id, recordKey);
      if (item.id) {
        await deleteSessionFromBackend(item.id, userKey);
      }
      await loadHistory();
    } catch (error) {
      Alert.alert("Delete failed", String(error.message || error));
    } finally {
      setDeletingKey(null);
    }
  }

  return (
    <ScrollView
      style={commonStyles.screen}
      contentContainerStyle={commonStyles.screenBottomSpace}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={loadHistory} tintColor={colors.primary} />}
    >
      <View style={commonStyles.heroCard}>
        <Text style={commonStyles.eyebrow}>Film Room</Text>
        <Text style={[commonStyles.title, { marginTop: 10 }]}>Session History</Text>
        <Text style={commonStyles.subtitle}>
          Pull down to refresh your stored training archive from local storage and the backend.
        </Text>
      </View>

      {history.length === 0 ? (
        <View style={commonStyles.card}>
          <Text style={commonStyles.sectionTitle}>No Sessions Yet</Text>
          <Text style={commonStyles.subtitle}>
            Complete a live analysis or shooting training run to start building your performance timeline.
          </Text>
        </View>
      ) : (
        history.map((item, index) => (
          <View key={`${item.id || "session"}-${index}`} style={commonStyles.card}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={commonStyles.eyebrow}>Archived Session</Text>
                <Text style={[commonStyles.sectionTitle, { marginTop: 10 }]}>
                  {item.modeLabel || humanizeMode(item.mode)}
                </Text>
              </View>
              <ScoreBadge score={item.score} />
            </View>

            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 14 }}>
              <InfoPill label={item.classification || "Pending"} color={classificationColor(item.classification)} />
              <InfoPill label={new Date(item.timestamp).toLocaleString()} color={colors.secondary} />
              {item.localVideoUri ? <InfoPill label="Offline Video Saved" color={colors.success} /> : null}
            </View>

            {item.summary ? (
              <Text style={[commonStyles.subtitle, { marginTop: 14, color: colors.text }]}>{item.summary}</Text>
            ) : null}

            <View style={commonStyles.divider} />
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
              <Text style={commonStyles.label}>Detected Errors</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: 8, flex: 1 }}>
                {item.localVideoUri ? (
                  <TouchableOpacity
                    activeOpacity={0.85}
                    disabled={deletingKey === item.sourceKey}
                    onPress={() =>
                      setPreviewKey((current) => (current === item.sourceKey ? null : item.sourceKey))
                    }
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: colors.secondary,
                      backgroundColor: "rgba(110, 203, 255, 0.12)",
                      opacity: deletingKey === item.sourceKey ? 0.65 : 1,
                      flexShrink: 1,
                    }}
                  >
                    <Text
                      style={{ color: colors.secondary, fontSize: 11, fontWeight: "800", letterSpacing: 0.6 }}
                      numberOfLines={1}
                    >
                      {previewKey === item.sourceKey ? "HIDE VIDEO" : "WATCH VIDEO"}
                    </Text>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity
                  activeOpacity={0.85}
                  disabled={deletingKey === item.sourceKey}
                  onPress={() => confirmDelete(item)}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                    borderRadius: 999,
                    borderWidth: 1,
                      borderColor: colors.danger,
                      backgroundColor: "rgba(255, 123, 123, 0.12)",
                      opacity: deletingKey === item.sourceKey ? 0.65 : 1,
                      flexShrink: 1,
                    }}
                  >
                    <Text
                      style={{ color: colors.danger, fontSize: 11, fontWeight: "800", letterSpacing: 0.6 }}
                      numberOfLines={1}
                    >
                      {deletingKey === item.sourceKey ? "DELETING..." : "DELETE"}
                    </Text>
                </TouchableOpacity>
              </View>
            </View>
            {(item.detectedErrors || []).length === 0 ? (
              <Text style={commonStyles.subtitle}>No stored error list for this record.</Text>
            ) : (
              item.detectedErrors.map((err, errIndex) => (
                <Text key={`${err.issue}-${errIndex}`} style={[commonStyles.subtitle, { color: colors.text }]}>
                  - {err.issue} ({err.severity})
                </Text>
              ))
            )}

            {previewKey === item.sourceKey && item.localVideoUri ? (
              <>
                <View
                  style={{
                    marginTop: 16,
                    overflow: "hidden",
                    borderRadius: 20,
                    borderWidth: 1,
                    borderColor: colors.border,
                    backgroundColor: "#040b15",
                  }}
                >
                  <ArchivedVideoPlayer videoUrl={item.localVideoUri} />
                </View>
                <Text style={[commonStyles.subtitle, { marginTop: 10, fontSize: 12 }]}>
                  This annotated session video is stored locally on this phone and can be replayed offline.
                </Text>
              </>
            ) : null}
          </View>
        ))
      )}
    </ScrollView>
  );
}

function ScoreBadge({ score }) {
  return (
    <View
      style={{
        minWidth: 74,
        borderRadius: 18,
        paddingHorizontal: 14,
        paddingVertical: 12,
        backgroundColor: "rgba(255, 122, 26, 0.14)",
        borderWidth: 1,
        borderColor: "rgba(255, 122, 26, 0.3)",
      }}
    >
      <Text style={{ color: colors.muted, fontSize: 10, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase" }}>
        Score
      </Text>
      <Text style={{ marginTop: 6, color: colors.primary, fontSize: 22, fontWeight: "800" }}>
        {score ?? "--"}
      </Text>
    </View>
  );
}

function InfoPill({ label, color }) {
  return (
    <View style={[commonStyles.pill, { borderColor: color, backgroundColor: "rgba(7, 17, 31, 0.28)" }]}>
      <Text style={[commonStyles.pillText, { color }]}>{label}</Text>
    </View>
  );
}

function classificationColor(classification) {
  const label = String(classification || "").toLowerCase();
  if (label.includes("excellent")) return colors.success;
  if (label.includes("good")) return colors.secondary;
  if (label.includes("fair")) return colors.warning;
  if (label.includes("poor")) return colors.danger;
  return colors.text;
}

function ArchivedVideoPlayer({ videoUrl }) {
  const player = useVideoPlayer(
    {
      uri: videoUrl,
      useCaching: true,
    },
    (instance) => {
      instance.loop = true;
    }
  );
  const { isPlaying } = useEvent(player, "playingChange", { isPlaying: player.playing });

  return (
    <View>
      <VideoView
        style={{ width: "100%", height: 240, backgroundColor: "#040b15" }}
        player={player}
        nativeControls
        allowsFullscreen
        contentFit="contain"
      />
      <View style={{ padding: 14, borderTopWidth: 1, borderTopColor: colors.border }}>
        <TouchableOpacity
          activeOpacity={0.9}
          onPress={() => {
            if (isPlaying) {
              player.pause();
            } else {
              player.play();
            }
          }}
          style={{
            borderRadius: 14,
            borderWidth: 1,
            borderColor: colors.primary,
            backgroundColor: "rgba(255, 122, 26, 0.12)",
            paddingVertical: 12,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ color: colors.primary, fontSize: 14, fontWeight: "800" }}>
            {isPlaying ? "Pause Saved Video" : "Play Saved Video"}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
