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
  if (!notificationsSupported()) return;
  if (Notification.permission !== "granted") return;
  if (document.visibilityState === "visible") return;

  const title = "MobileClaw";
  const body = messagePreview.length > 120
    ? messagePreview.slice(0, 117) + "..."
    : messagePreview;

  const notification = new Notification(title, {
    body: body || "Agent finished responding",
    tag: "mobileclaw-message",
    icon: "/apple-icon.png",
  });

  // Bring the app to focus when tapped
  notification.onclick = () => {
    window.focus();
    notification.close();
  };
}
