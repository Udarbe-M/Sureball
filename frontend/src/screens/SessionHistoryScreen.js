import { useEvent } from "expo";
import { VideoView, useVideoPlayer } from "expo-video";
import React, { useCallback, useMemo, useState } from "react";
import { Alert, Linking, RefreshControl, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "../context/AuthContext";
import {
  buildCoachingVideoDownloadUrl,
  buildShootingTrainingDownloadUrl,
  deleteSessionFromBackend,
  fetchSessionsFromBackend,
} from "../services/api";
import { hapticSelection, hapticSuccess, hapticWarning } from "../services/haptics";
import {
  deleteLocalSessionRecord,
  getLocalSessionHistory,
  saveAnnotatedVideoLocally,
  saveSessionRecord,
} from "../services/storage";
import { colors } from "../theme/colors";
import { commonStyles } from "../theme/styles";
import { humanizeMode } from "../utils/helpers";
import { buildUserKey } from "../utils/userKey";

function mergeHistory(localSessions, backendSessions) {
  const normalizedLocal = localSessions.map((item) => ({
    ...item,
    sourceKey: item.id || `${item.mode}-${item.timestamp}`,
    remoteVideoUrl: item.remoteVideoUrl || buildRemoteVideoUrl(item.mode, item.id, item.sourceType),
    shootingStats: item.shootingStats || item.shooting_stats || null,
    shotEvents: normalizeShotEvents(item.shotEvents || item.shot_events),
  }));
  const normalizedBackend = backendSessions.map((item) => ({
    id: item.session_id,
    mode: item.mode,
    sourceType: item.source_type,
    modeLabel: humanizeMode(item.mode),
    score: item.score,
    actionCount: item.action_count || 0,
    actionLabel: item.action_label || "",
    classification: item.classification,
    detectedErrors: [],
    timestamp: item.timestamp,
    summary: item.summary,
    sourceKey: item.session_id,
    remoteVideoUrl: buildRemoteVideoUrl(item.mode, item.session_id, item.source_type),
    shootingStats: item.shooting_stats || null,
    shotEvents: normalizeShotEvents(item.shot_events),
  }));
  const full = [...normalizedLocal, ...normalizedBackend];
  const seen = new Set();
  const deduped = [];
  for (const entry of full) {
    const key = entry.id || `${entry.mode}-${entry.timestamp}`;
    if (seen.has(key)) {
      const existing = deduped.find((item) => (item.id || `${item.mode}-${item.timestamp}`) === key);
      if (existing) {
        existing.remoteVideoUrl = existing.remoteVideoUrl || entry.remoteVideoUrl;
        existing.shootingStats = existing.shootingStats || entry.shootingStats;
        existing.actionCount = existing.actionCount || entry.actionCount;
        existing.actionLabel = existing.actionLabel || entry.actionLabel;
        if ((!existing.shotEvents || existing.shotEvents.length === 0) && entry.shotEvents?.length) {
          existing.shotEvents = entry.shotEvents;
        }
      }
      continue;
    }
    seen.add(key);
    deduped.push(entry);
  }
  return deduped.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

function buildRemoteVideoUrl(mode, sessionId, sourceType = null) {
  if (!sessionId) {
    return null;
  }
  if (sourceType === "shot_training_video" || mode === "shot_training" || mode === "shooting_training") {
    return buildShootingTrainingDownloadUrl(sessionId);
  }
  if ((sourceType === "video" || sourceType == null) && ["shooting_form", "dribbling", "passing"].includes(mode)) {
    return buildCoachingVideoDownloadUrl(sessionId);
  }
  return null;
}

function normalizeShotEvents(events) {
  if (!Array.isArray(events)) {
    return [];
  }
  return events
    .map((event, index) => {
      const source = event || {};
      const timestampSeconds = numericOrNull(source.timestampSeconds ?? source.timestamp_seconds);
      const resultTimestampSeconds = numericOrNull(source.resultTimestampSeconds ?? source.result_timestamp_seconds);
      const reviewStartSeconds = timestampSeconds ?? resultTimestampSeconds ?? 0;
      return {
        shotNumber: Number(source.shotNumber ?? source.shot_number ?? index + 1) || index + 1,
        result: String(source.result || "pending").toLowerCase(),
        timestampSeconds: reviewStartSeconds,
        resultTimestampSeconds,
        reviewSeconds: Math.max(0, reviewStartSeconds - 1),
        startFrame: Number(source.startFrame ?? source.start_frame ?? 0) || 0,
        resultFrame: Number(source.resultFrame ?? source.result_frame ?? 0) || null,
      };
    })
    .sort((a, b) => a.shotNumber - b.shotNumber);
}

function numericOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatShotTime(seconds) {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = String(safeSeconds % 60).padStart(2, "0");
  return `${minutes}:${remainder}`;
}

function formatShotResult(result) {
  if (result === "make") return "Make";
  if (result === "miss") return "Miss";
  return "Review";
}

function shotResultColor(result) {
  if (result === "make") return colors.success;
  if (result === "miss") return colors.warning;
  return colors.secondary;
}

function scoreForTrend(item) {
  if (item.mode === "shooting_form" && item.shootingStats?.attempts) {
    return Number(item.shootingStats.accuracy || 0);
  }
  if (item.score === null || item.score === undefined || item.score === "") {
    return Number.NaN;
  }
  return Number(item.score);
}

function countForTrend(item) {
  if (item.mode === "shooting_form" && item.shootingStats?.attempts) {
    return {
      label: "Shots",
      value: `${item.shootingStats.makes || 0}/${item.shootingStats.attempts || 0}`,
    };
  }
  if (item.actionLabel) {
    return {
      label: item.actionLabel,
      value: item.actionCount || 0,
    };
  }
  return null;
}

function buildProgressTrends(history) {
  const byMode = new Map();
  history.forEach((item) => {
    if (!item.mode) {
      return;
    }
    const score = scoreForTrend(item);
    if (!Number.isFinite(score)) {
      return;
    }
    const sessions = byMode.get(item.mode) || [];
    sessions.push({ item, score });
    byMode.set(item.mode, sessions);
  });

  return Array.from(byMode.entries())
    .map(([mode, sessions]) => {
      const sorted = sessions.sort(
        (a, b) => new Date(b.item.timestamp).getTime() - new Date(a.item.timestamp).getTime()
      );
      const latest = sorted[0];
      const previous = sorted[1];
      const delta = previous ? latest.score - previous.score : null;
      return {
        mode,
        label: humanizeMode(mode),
        metricLabel: mode === "shooting_form" ? "Accuracy" : "Score",
        latestScore: latest.score,
        delta,
        sessionCount: sorted.length,
        action: countForTrend(latest.item),
      };
    })
    .filter((trend) => trend.sessionCount > 0)
    .sort((a, b) => a.label.localeCompare(b.label));
}

function buildArchivedReviewEvents(item) {
  if (item.shotEvents?.length) {
    return item.shotEvents;
  }
  if (item.mode === "dribbling") {
    return [
      { label: "Start Stance", result: "review", timestampSeconds: 0, reviewSeconds: 0 },
      { label: "Control Check", result: "review", timestampSeconds: 5, reviewSeconds: 5 },
      { label: "Finish Rhythm", result: "review", timestampSeconds: 10, reviewSeconds: 10 },
    ];
  }
  if (item.mode === "passing") {
    return [
      { label: "Load", result: "review", timestampSeconds: 0, reviewSeconds: 0 },
      { label: "Release Line", result: "review", timestampSeconds: 5, reviewSeconds: 5 },
      { label: "Balance Finish", result: "review", timestampSeconds: 10, reviewSeconds: 10 },
    ];
  }
  return [];
}

export default function SessionHistoryScreen() {
  const { playerEmail, playerName, userId } = useAuth();
  const userKey = buildUserKey({ userId, playerName, playerEmail });
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState([]);
  const [deletingKey, setDeletingKey] = useState(null);
  const [downloadingKey, setDownloadingKey] = useState(null);
  const [previewKey, setPreviewKey] = useState(null);
  const [selectedFilter, setSelectedFilter] = useState("all");

  const filterOptions = useMemo(() => {
    const availableModes = [...new Set(history.map((item) => item.mode).filter(Boolean))];
    return [
      { id: "all", label: "All" },
      { id: "saved_video", label: "Saved Videos" },
      ...availableModes.map((mode) => ({ id: mode, label: humanizeMode(mode) })),
    ];
  }, [history]);

  const visibleHistory = useMemo(() => {
    if (selectedFilter === "all") {
      return history;
    }
    if (selectedFilter === "saved_video") {
      return history.filter((item) => item.localVideoUri);
    }
    return history.filter((item) => item.mode === selectedFilter);
  }, [history, selectedFilter]);
  const modeTrends = useMemo(() => buildProgressTrends(history), [history]);

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
      hapticSuccess();
      await loadHistory();
    } catch (error) {
      hapticWarning();
      Alert.alert("Delete failed", String(error.message || error));
    } finally {
      setDeletingKey(null);
    }
  }

  async function openSessionVideo(item) {
    const videoUrl = item.localVideoUri || item.remoteVideoUrl || buildRemoteVideoUrl(item.mode, item.id, item.sourceType);
    if (!videoUrl) {
      Alert.alert("Video unavailable", "This session does not have an annotated video to open.");
      return;
    }
    try {
      hapticSelection();
      await Linking.openURL(videoUrl);
    } catch (error) {
      Alert.alert("Video unavailable", String(error.message || error));
    }
  }

  async function downloadSessionVideo(item) {
    const recordKey = item.sourceKey || item.id || `${item.mode}-${item.timestamp}`;
    const remoteVideoUrl = item.remoteVideoUrl || buildRemoteVideoUrl(item.mode, item.id, item.sourceType);
    if (!remoteVideoUrl) {
      Alert.alert("Video unavailable", "This archived session does not have a downloadable backend video.");
      return;
    }

    setDownloadingKey(recordKey);
    try {
      const localVideoUri = await saveAnnotatedVideoLocally({
        remoteUrl: remoteVideoUrl,
        sessionId: item.id,
        mode: item.mode,
        timestamp: item.timestamp,
        suffix: "archive",
      });
      await saveSessionRecord(userKey, {
        ...item,
        id: item.id,
        sourceKey: recordKey,
        remoteVideoUrl,
        localVideoUri,
      });
      hapticSuccess();
      Alert.alert("Video downloaded", "This session video is now saved for offline playback in Session History.");
      await loadHistory();
    } catch (error) {
      hapticWarning();
      Alert.alert("Download failed", String(error.message || error));
    } finally {
      setDownloadingKey(null);
    }
  }

  function handleFilterChange(filterId) {
    hapticSelection();
    setSelectedFilter(filterId);
    setPreviewKey(null);
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

      {history.length > 0 ? (
        <View style={commonStyles.card}>
          <Text style={commonStyles.label}>Filter</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 14 }}>
            {filterOptions.map((option) => {
              const active = selectedFilter === option.id;
              return (
                <TouchableOpacity
                  key={option.id}
                  activeOpacity={0.9}
                  onPress={() => handleFilterChange(option.id)}
                  style={{
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: active ? colors.primary : colors.border,
                    backgroundColor: active ? colors.primary : colors.backgroundSoft,
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                  }}
                >
                  <Text style={{ color: active ? "#091220" : colors.text, fontSize: 12, fontWeight: "900" }}>
                    {option.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      ) : null}

      {modeTrends.length > 0 ? (
        <View style={commonStyles.card}>
          <Text style={commonStyles.label}>Progress Trends</Text>
          <View style={{ marginTop: 14, gap: 10 }}>
            {modeTrends.map((trend) => {
              const deltaColor =
                trend.delta === null ? colors.muted : trend.delta >= 0 ? colors.success : colors.warning;
              const deltaLabel =
                trend.delta === null
                  ? "No comparison yet"
                  : `${trend.delta >= 0 ? "+" : ""}${trend.delta.toFixed(1)} from last`;
              return (
                <View
                  key={trend.mode}
                  style={{
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: colors.border,
                    backgroundColor: colors.backgroundSoft,
                    padding: 13,
                  }}
                >
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.text, fontSize: 14, fontWeight: "900" }}>{trend.label}</Text>
                      <Text style={{ marginTop: 4, color: colors.muted, fontSize: 11, fontWeight: "800" }}>
                        {trend.sessionCount} session{trend.sessionCount === 1 ? "" : "s"}
                      </Text>
                    </View>
                    <View style={{ alignItems: "flex-end" }}>
                      <Text style={{ color: colors.muted, fontSize: 10, fontWeight: "900", textTransform: "uppercase" }}>
                        {trend.metricLabel}
                      </Text>
                      <Text style={{ marginTop: 3, color: colors.primary, fontSize: 20, fontWeight: "900" }}>
                        {trend.latestScore.toFixed(1)}
                        {trend.metricLabel === "Accuracy" ? "%" : ""}
                      </Text>
                    </View>
                  </View>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                    <InfoPill label={deltaLabel} color={deltaColor} />
                    {trend.action ? <InfoPill label={`${trend.action.label}: ${trend.action.value}`} color={colors.accent} /> : null}
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      ) : null}

      {history.length === 0 ? (
        <View style={commonStyles.card}>
          <Text style={commonStyles.sectionTitle}>No Sessions Yet</Text>
          <Text style={commonStyles.subtitle}>
            Complete a live analysis or shooting training run to start building your performance timeline.
          </Text>
        </View>
      ) : visibleHistory.length === 0 ? (
        <View style={commonStyles.card}>
          <Text style={commonStyles.sectionTitle}>No Matching Sessions</Text>
          <Text style={commonStyles.subtitle}>Try another filter or record a new session in this mode.</Text>
        </View>
      ) : (
        visibleHistory.map((item, index) => (
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
              {item.actionLabel ? <InfoPill label={`${item.actionLabel}: ${item.actionCount || 0}`} color={colors.accent} /> : null}
              {item.localVideoUri ? <InfoPill label="Offline Video Saved" color={colors.success} /> : null}
              {!item.localVideoUri && item.remoteVideoUrl ? <InfoPill label="Backend Video" color={colors.warning} /> : null}
            </View>

            {item.summary ? (
              <Text style={[commonStyles.subtitle, { marginTop: 14, color: colors.text }]}>{item.summary}</Text>
            ) : null}

            <View style={commonStyles.divider} />
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
              <Text style={commonStyles.label}>Detected Errors</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: 8, flex: 1 }}>
                {item.localVideoUri || item.remoteVideoUrl ? (
                  <TouchableOpacity
                    activeOpacity={0.85}
                    disabled={deletingKey === item.sourceKey || downloadingKey === item.sourceKey}
                    onPress={() => {
                      hapticSelection();
                      setPreviewKey((current) => (current === item.sourceKey ? null : item.sourceKey));
                    }}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: colors.secondary,
                      backgroundColor: "rgba(110, 203, 255, 0.12)",
                      opacity: deletingKey === item.sourceKey || downloadingKey === item.sourceKey ? 0.65 : 1,
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
                {!item.localVideoUri && item.remoteVideoUrl ? (
                  <TouchableOpacity
                    activeOpacity={0.85}
                    disabled={deletingKey === item.sourceKey || downloadingKey === item.sourceKey}
                    onPress={() => downloadSessionVideo(item)}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: colors.success,
                      backgroundColor: "rgba(74, 222, 128, 0.12)",
                      opacity: deletingKey === item.sourceKey || downloadingKey === item.sourceKey ? 0.65 : 1,
                      flexShrink: 1,
                    }}
                  >
                    <Text
                      style={{ color: colors.success, fontSize: 11, fontWeight: "800", letterSpacing: 0.6 }}
                      numberOfLines={1}
                    >
                      {downloadingKey === item.sourceKey ? "DOWNLOADING..." : "DOWNLOAD VIDEO"}
                    </Text>
                  </TouchableOpacity>
                ) : null}
                {item.localVideoUri || item.remoteVideoUrl ? (
                  <TouchableOpacity
                    activeOpacity={0.85}
                    disabled={deletingKey === item.sourceKey || downloadingKey === item.sourceKey}
                    onPress={() => openSessionVideo(item)}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: colors.primary,
                      backgroundColor: "rgba(255, 122, 26, 0.12)",
                      opacity: deletingKey === item.sourceKey || downloadingKey === item.sourceKey ? 0.65 : 1,
                      flexShrink: 1,
                    }}
                  >
                    <Text
                      style={{ color: colors.primary, fontSize: 11, fontWeight: "800", letterSpacing: 0.6 }}
                      numberOfLines={1}
                    >
                      OPEN VIDEO
                    </Text>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity
                  activeOpacity={0.85}
                  disabled={deletingKey === item.sourceKey || downloadingKey === item.sourceKey}
                  onPress={() => confirmDelete(item)}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: colors.danger,
                    backgroundColor: "rgba(255, 123, 123, 0.12)",
                    opacity: deletingKey === item.sourceKey || downloadingKey === item.sourceKey ? 0.65 : 1,
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

            {previewKey === item.sourceKey && (item.localVideoUri || item.remoteVideoUrl) ? (
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
                  <ArchivedVideoPlayer
                    videoUrl={item.localVideoUri || item.remoteVideoUrl}
                    reviewEvents={buildArchivedReviewEvents(item)}
                  />
                </View>
                <Text style={[commonStyles.subtitle, { marginTop: 10, fontSize: 12 }]}>
                  {item.localVideoUri
                    ? "This annotated session video is stored locally on this phone and can be replayed offline."
                    : "This annotated session video is streaming from the backend. Download it to keep an offline copy."}
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

function ArchivedVideoPlayer({ videoUrl, reviewEvents = [] }) {
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
  const videoMoments = Array.isArray(reviewEvents) ? reviewEvents : [];

  function jumpToMoment(event) {
    hapticSelection();
    player.currentTime = Number(event.reviewSeconds || 0);
    player.play();
  }

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
            {isPlaying ? "Pause Video" : "Play Video"}
          </Text>
        </TouchableOpacity>
        {videoMoments.length > 0 ? (
          <View style={{ marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: colors.border }}>
            <Text style={[commonStyles.label, { marginBottom: 10 }]}>Review Moments</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              {videoMoments.map((event, index) => {
                const resultColor = shotResultColor(event.result);
                const resultTime = event.resultTimestampSeconds ?? event.timestampSeconds;
                const momentLabel = event.label || `Shot ${event.shotNumber || index + 1}`;
                return (
                  <TouchableOpacity
                    key={`${momentLabel}-${event.timestampSeconds ?? index}`}
                    activeOpacity={0.85}
                    onPress={() => jumpToMoment(event)}
                    style={{
                      borderRadius: 14,
                      borderWidth: 1,
                      borderColor: resultColor,
                      backgroundColor: "rgba(7, 17, 31, 0.36)",
                      paddingHorizontal: 12,
                      paddingVertical: 10,
                      minWidth: 104,
                    }}
                  >
                    <Text style={{ color: colors.text, fontSize: 12, fontWeight: "900" }}>
                      {momentLabel}
                    </Text>
                    <Text style={{ color: resultColor, fontSize: 11, fontWeight: "800", marginTop: 3 }}>
                      {formatShotResult(event.result)} at {formatShotTime(resultTime)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        ) : null}
      </View>
    </View>
  );
}
