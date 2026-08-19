import { shouldNotifyLoopState, type LoopState } from "@orca/shared";

export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return false;
  }
  if (Notification.permission === "granted") {
    return true;
  }
  if (Notification.permission !== "denied") {
    const permission = await Notification.requestPermission();
    return permission === "granted";
  }
  return false;
}

export function notifyStateChange(
  repositoryName: string,
  state: LoopState,
  detail?: string
): void {
  if (!shouldNotifyLoopState(state)) {
    return;
  }

  if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
    const title = `Orca: ${repositoryName} [${state}]`;
    const body = detail || `Run transitioned to ${state}. Action may be required.`;
    try {
      new Notification(title, { body, icon: "/favicon.ico" });
    } catch {
      // Notification failed
    }
  }
}
