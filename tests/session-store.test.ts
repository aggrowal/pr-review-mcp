import { describe, expect, it } from "vitest";
import { ReviewSessionStore } from "../src/review/session-store.js";

describe("ReviewSessionStore", () => {
  it("creates and looks up sessions", () => {
    let now = 1_000_000;
    const store = new ReviewSessionStore(() => now);

    const session = store.createSession({
      assembledPrompt: "prompt",
      trackContracts: [],
      ttlMinutes: 30,
      maxAttempts: 3,
      outputFormat: "json",
    });

    const lookup = store.lookup(session.sessionId);
    expect(lookup.ok).toBe(true);
    if (lookup.ok) {
      expect(lookup.session.outputFormat).toBe("json");
      expect(lookup.session.maxAttempts).toBe(3);
    }
  });

  it("increments validation attempts and enforces max", () => {
    const store = new ReviewSessionStore(() => 1_000_000);
    const session = store.createSession({
      assembledPrompt: "prompt",
      trackContracts: [],
      ttlMinutes: 30,
      maxAttempts: 2,
      outputFormat: "markdown",
    });

    const attempt1 = store.beginValidationAttempt(session.sessionId);
    expect(attempt1.ok).toBe(true);
    if (attempt1.ok) {
      expect(attempt1.session.attempt).toBe(1);
    }

    const attempt2 = store.beginValidationAttempt(session.sessionId);
    expect(attempt2.ok).toBe(true);
    if (attempt2.ok) {
      expect(attempt2.session.attempt).toBe(2);
    }

    const attempt3 = store.beginValidationAttempt(session.sessionId);
    expect(attempt3.ok).toBe(false);
    if (!attempt3.ok) {
      expect(attempt3.reason).toBe("attempts_exhausted");
    }
  });

  it("expires sessions based on TTL", () => {
    let now = 1_000_000;
    const store = new ReviewSessionStore(() => now);
    const session = store.createSession({
      assembledPrompt: "prompt",
      trackContracts: [],
      ttlMinutes: 5,
      maxAttempts: 2,
      outputFormat: "json",
    });

    now += 6 * 60 * 1000;
    const lookup = store.lookup(session.sessionId);
    expect(lookup.ok).toBe(false);
    if (!lookup.ok) {
      expect(lookup.reason).toBe("expired");
    }
  });
});
