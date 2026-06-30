import { useEvent } from "expo";
import { Feather } from "@expo/vector-icons";
import { Asset } from "expo-asset";
import { VideoView, useVideoPlayer } from "expo-video";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { colors } from "../theme/colors";

export default function CorePoseTutorialVideo({ source, fallbackImage, accessibilityLabel }) {
  const [resolvedUri, setResolvedUri] = useState("");
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let active = true;
    setResolvedUri("");
    setLoadError("");

    async function resolveTutorialAsset() {
      try {
        const asset = Asset.fromModule(source);
        await asset.downloadAsync();
        const uri = asset.localUri || asset.uri;
        if (!uri) {
          throw new Error("Tutorial video URI is unavailable.");
        }
        if (active) {
          setResolvedUri(uri);
        }
      } catch (error) {
        if (active) {
          setLoadError(String(error?.message || error || "Unable to load tutorial video."));
        }
      }
    }

    void resolveTutorialAsset();
    return () => {
      active = false;
    };
  }, [source]);

  if (!resolvedUri) {
    return (
      <View style={styles.frame}>
        <Image source={fallbackImage} accessibilityLabel={accessibilityLabel} style={styles.video} resizeMode="contain" />
        <View style={styles.overlay}>
          {loadError ? <Feather name="alert-circle" size={20} color={colors.warning} /> : <ActivityIndicator color={colors.primary} />}
          <Text selectable style={styles.message}>
            {loadError ? "Tutorial could not load. Reopen this guide to retry." : "Preparing tutorial video..."}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <ResolvedTutorialVideo
      uri={resolvedUri}
      fallbackImage={fallbackImage}
      accessibilityLabel={accessibilityLabel}
    />
  );
}

function ResolvedTutorialVideo({ uri, fallbackImage, accessibilityLabel }) {
  const videoViewRef = useRef(null);
  const [fullscreenError, setFullscreenError] = useState("");
  const player = useVideoPlayer({ uri }, (instance) => {
    instance.loop = false;
    instance.muted = false;
  });
  const { isPlaying } = useEvent(player, "playingChange", { isPlaying: player.playing });
  const { status, error } = useEvent(player, "statusChange", { status: player.status, error: player.error });
  const failed = status === "error";

  async function openFullscreen() {
    setFullscreenError("");
    try {
      player.play();
      await videoViewRef.current?.enterFullscreen();
    } catch (fullscreenFailure) {
      setFullscreenError(String(fullscreenFailure?.message || "Fullscreen playback is unavailable."));
    }
  }

  return (
    <View style={styles.frame}>
      {failed ? (
        <Image source={fallbackImage} accessibilityLabel={accessibilityLabel} style={styles.video} resizeMode="contain" />
      ) : (
        <VideoView
          ref={videoViewRef}
          accessibilityLabel={accessibilityLabel}
          style={styles.video}
          player={player}
          nativeControls={false}
          fullscreenOptions={{ enable: true, orientation: "landscape" }}
          contentFit="contain"
        />
      )}
      {status === "loading" ? (
        <View style={styles.overlay}>
          <ActivityIndicator color={colors.primary} />
          <Text selectable style={styles.message}>Loading tutorial video...</Text>
        </View>
      ) : null}
      {failed ? (
        <View style={styles.overlay}>
          <Feather name="alert-circle" size={20} color={colors.warning} />
          <Text selectable style={styles.message}>{error?.message || "Tutorial playback is unavailable."}</Text>
        </View>
      ) : null}
      <View style={styles.controls}>
        <TouchableOpacity
          accessibilityLabel={isPlaying ? "Pause core pose tutorial" : "Play core pose tutorial"}
          activeOpacity={0.88}
          disabled={failed}
          onPress={() => {
            if (isPlaying) {
              player.pause();
            } else {
              player.play();
            }
          }}
          style={[styles.controlButton, failed && styles.controlButtonDisabled]}
        >
          <Feather name={isPlaying ? "pause" : "play"} size={14} color="#091220" />
          <Text style={styles.controlButtonText}>{isPlaying ? "Pause" : "Play Tutorial"}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityLabel="Watch tutorial in full screen"
          activeOpacity={0.88}
          disabled={failed}
          onPress={() => void openFullscreen()}
          style={[styles.controlButton, styles.fullscreenButton, failed && styles.controlButtonDisabled]}
        >
          <Feather name="maximize" size={14} color={colors.text} />
          <Text style={[styles.controlButtonText, styles.fullscreenButtonText]}>Full Screen</Text>
        </TouchableOpacity>
      </View>
      {fullscreenError ? <Text selectable style={styles.fullscreenError}>{fullscreenError}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: "100%",
    marginTop: 12,
    borderRadius: 14,
    backgroundColor: colors.backgroundSoft,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  video: {
    width: "100%",
    height: 230,
    backgroundColor: colors.backgroundSoft,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    bottom: 45,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 24,
    backgroundColor: "rgba(4, 11, 21, 0.72)",
  },
  message: {
    color: colors.text,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "800",
    textAlign: "center",
  },
  controls: {
    flexDirection: "row",
    minHeight: 44,
  },
  controlButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingVertical: 11,
    backgroundColor: colors.primary,
  },
  fullscreenButton: {
    backgroundColor: "#172536",
    borderLeftWidth: 1,
    borderLeftColor: colors.border,
  },
  controlButtonDisabled: {
    opacity: 0.45,
  },
  controlButtonText: {
    color: "#091220",
    fontSize: 12,
    fontWeight: "900",
  },
  fullscreenButtonText: {
    color: colors.text,
  },
  fullscreenError: {
    color: colors.warning,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "800",
    textAlign: "center",
  },
});
