import { describe, it, expect, vi } from "vitest";
import { notifyStateChange } from "../src/lib/notifications.js";

describe("UI Notifications (Task 2)", () => {
  it("2.T1 does not trigger notification for quiet states", () => {
    const notifySpy = vi.fn();
    (global as any).Notification = notifySpy;

    notifyStateChange("TabDock", "SOL_REVIEWING");
    expect(notifySpy).not.toHaveBeenCalled();
  });
});
