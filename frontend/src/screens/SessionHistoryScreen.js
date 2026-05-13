import React, { useCallback, useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { commonStyles } from "../theme/styles";
import { fetchSessionsFromBackend } from "../services/api";
import { getLocalSessionHistory } from "../services/storage";
import { colors } from "../theme/colors";
import { humanizeMode } from "../utils/helpers";

function mergeHistory(localSessions, backendSessions) {
  const normalizedBackend = backendSessions.map((item) => ({
    id: item.session_id,
    mode: item.mode,
    modeLabel: humanizeMode(item.mode),
    score: item.score,
    classification: item.classification,
    detectedErrors: [],
    timestamp: item.timestamp,
  }));
  const full = [...localSessions, ...normalizedBackend];
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
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState([]);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    try {
      const [localSessions, backendSessions] = await Promise.all([
        getLocalSessionHistory(),
        fetchSessionsFromBackend(),
      ]);
      setHistory(mergeHistory(localSessions, backendSessions));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadHistory();
    }, [loadHistory])
  );

  return (
    <ScrollView
      style={commonStyles.screen}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={loadHistory} />}
    >
      <View style={commonStyles.card}>
        <Text style={commonStyles.title}>Previous Sessions</Text>
        <Text style={commonStyles.subtitle}>Pull down to refresh data from local storage and backend.</Text>
      </View>

      {history.length === 0 ? (
        <View style={commonStyles.card}>
          <Text style={commonStyles.subtitle}>No sessions yet. Complete at least one live analysis to populate history.</Text>
        </View>
      ) : (
        history.map((item, index) => (
          <View key={`${item.id || "session"}-${index}`} style={commonStyles.card}>
            <Text style={{ fontSize: 16, fontWeight: "700", color: colors.secondary }}>
              {item.modeLabel || humanizeMode(item.mode)}
            </Text>
            <Text style={commonStyles.subtitle}>
              Score: {item.score} | Classification: {item.classification}
            </Text>
            <Text style={[commonStyles.subtitle, { fontSize: 12 }]}>
              {new Date(item.timestamp).toLocaleString()}
            </Text>

            <Text style={[commonStyles.label, { marginTop: 12 }]}>Detected Errors</Text>
            {(item.detectedErrors || []).length === 0 ? (
              <Text style={commonStyles.subtitle}>No stored error list for this record.</Text>
            ) : (
              item.detectedErrors.map((err, errIndex) => (
                <Text key={`${err.issue}-${errIndex}`} style={[commonStyles.subtitle, { color: colors.text }]}>
                  - {err.issue} ({err.severity})
                </Text>
              ))
            )}
          </View>
        ))
      )}
      <View style={{ marginBottom: 20 }} />
    </ScrollView>
  );
}
