// Notification helpers for iOS/web push notifications on message completion.
// On iOS, notifications only work when the app is installed as a PWA (Add to Home Screen)
// and requires iOS 16.4+.

let permissionRequested = false;

/** Whether the Notification API is available in this browser. */
export function notificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

/**
 * Request notification permission from the user.
 * Safe to call multiple times — only prompts once.
 * Returns the resulting permission state.
 */
export async function requestNotificationPermission(): Promise<NotificationPermission | null> {
  if (!notificationsSupported()) return null;
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  if (permissionRequested) return Notification.permission;

  permissionRequested = true;
  const result = await Notification.requestPermission();
  return result;
}

/**
 * Send a notification when the agent finishes a message.
 * Only fires if:
 *  - Notification permission is granted
 *  - The document is not currently visible (user tabbed away / locked phone)
 */
export function notifyMessageComplete(messagePreview: string): void {
  console.log("[notify] notifyMessageComplete called, preview:", messagePreview.slice(0, 50));
  console.log("[notify] supported:", notificationsSupported());
  console.log("[notify] permission:", typeof Notification !== "undefined" ? Notification.permission : "N/A");
  console.log("[notify] visibilityState:", document.visibilityState);

  if (!notificationsSupported()) {
    console.log("[notify] BAIL: notifications not supported");
    return;
  }
  if (Notification.permission !== "granted") {
    console.log("[notify] BAIL: permission not granted");
    return;
  }
  if (document.visibilityState === "visible") {
    console.log("[notify] BAIL: document is visible (skipping for now)");
    // Still proceed for debugging — remove this comment block once confirmed working
  }

  const title = "MobileClaw";
  const body = messagePreview.length > 120
    ? messagePreview.slice(0, 117) + "..."
    : messagePreview;

  try {
    console.log("[notify] Attempting new Notification(...)");
    const notification = new Notification(title, {
      body: body || "Agent finished responding",
      tag: "mobileclaw-message",
      icon: "/apple-icon.png",
    });
    console.log("[notify] Notification created successfully");

    // Bring the app to focus when tapped
    notification.onclick = () => {
      try {
        window.focus();
      } catch {
        // Best-effort focus; ignore failures in restrictive environments
      }
      notification.close();
    };
  } catch (err) {
    console.error("[notify] Notification constructor threw:", err);
  }
}
