import * as Haptics from "expo-haptics";

function runHaptic(effect) {
  try {
    const result = effect();
    if (result && typeof result.catch === "function") {
      result.catch(() => {});
    }
  } catch (_error) {
    // Haptics are best-effort and should never block core training flows.
  }
}

export function hapticImpact(style = Haptics.ImpactFeedbackStyle.Light) {
  runHaptic(() => Haptics.impactAsync(style));
}

export function hapticSelection() {
  runHaptic(() => Haptics.selectionAsync());
}

export function hapticSuccess() {
  runHaptic(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}

export function hapticWarning() {
  runHaptic(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));
}

export { Haptics };
