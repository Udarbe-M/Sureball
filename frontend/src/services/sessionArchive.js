import { getAutoSaveVideosPreference, saveAnnotatedVideoLocally, saveSessionRecord } from "./storage";

export async function archiveCompletedSession({
  userKey,
  record,
  remoteVideoUrl,
  videoSaveOptions,
  messages,
}) {
  const shouldAutoSaveVideo = await getAutoSaveVideosPreference(userKey);
  let localVideoUri = "";
  let archiveMessageTone = "warning";
  let archiveMessage = messages.disabled;

  if (shouldAutoSaveVideo) {
    try {
      localVideoUri = await saveAnnotatedVideoLocally({
        remoteUrl: remoteVideoUrl,
        ...videoSaveOptions,
      });
      archiveMessageTone = "success";
      archiveMessage = messages.success;
    } catch (downloadError) {
      archiveMessageTone = "warning";
      archiveMessage = `${messages.failurePrefix}: ${String(downloadError.message || downloadError)}`;
    }
  }

  await saveSessionRecord(userKey, {
    ...record,
    remoteVideoUrl,
    localVideoUri: localVideoUri || null,
  });

  return {
    archiveMessage,
    archiveMessageTone,
    autoSaveEnabled: shouldAutoSaveVideo,
    localVideoUri: localVideoUri || null,
  };
}
