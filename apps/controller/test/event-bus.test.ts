import { describe, it, expect } from "vitest";
import { EventBus } from "../src/events/event-bus.js";

describe("EventBus secret redaction (Finding O)", () => {
  it("strips credentials embedded in git remote URLs before forwarding", () => {
    const bus = new EventBus();
    const received: any[] = [];
    bus.subscribe((e) => received.push(e));

    bus.publish({
      type: "watcher.poll_completed",
      at: new Date().toISOString(),
      repositoryId: "repo-1",
      data: {
        reason: "Fetch failed: fatal: unable to access 'https://user:ghp_SECRETtoken@github.com/x/y.git/'"
      }
    });

    expect(received).toHaveLength(1);
    const reason: string = received[0].data.reason;
    expect(reason).toContain("https://***:***@github.com/x/y.git/");
    expect(reason).not.toContain("ghp_SECRETtoken");
  });

  it("redacts values of secret-named fields", () => {
    const bus = new EventBus();
    const received: any[] = [];
    bus.subscribe((e) => received.push(e));

    bus.publish({
      type: "watcher.poll_completed",
      at: new Date().toISOString(),
      repositoryId: "repo-1",
      data: { apiKey: "sk-live-12345", note: "benign" }
    });

    expect(received[0].data.apiKey).toBe("***redacted***");
    expect(received[0].data.note).toBe("benign");
  });

  it("does not mutate the original event object", () => {
    const bus = new EventBus();
    bus.subscribe(() => {});
    const original = {
      type: "loop.state_changed",
      at: new Date().toISOString(),
      repositoryId: "repo-1",
      data: { logMessage: "https://u:p@host/x" }
    };
    bus.publish(original as any);
    expect(original.data.logMessage).toBe("https://u:p@host/x");
  });
});
