import { randomUUID } from "crypto";
import type { TrackExecutionContract } from "../prompt/assemble.js";

export interface ReviewSession {
  sessionId: string;
  assembledPrompt: string;
  trackContracts: TrackExecutionContract[];
  createdAtMs: number;
  expiresAtMs: number;
  attempt: number;
  maxAttempts: number;
  outputFormat: "json" | "markdown";
}

export interface CreateSessionInput {
  assembledPrompt: string;
  trackContracts: TrackExecutionContract[];
  ttlMinutes: number;
  maxAttempts: number;
  outputFormat: "json" | "markdown";
}

export type SessionLookupResult =
  | { ok: true; session: ReviewSession }
  | { ok: false; reason: "missing" | "expired" };

export type BeginValidationResult =
  | { ok: true; session: ReviewSession }
  | { ok: false; reason: "missing" | "expired" | "attempts_exhausted" };

export class ReviewSessionStore {
  private readonly sessions = new Map<string, ReviewSession>();
  private readonly now: () => number;

  constructor(now: () => number = () => Date.now()) {
    this.now = now;
  }

  createSession(input: CreateSessionInput): ReviewSession {
    this.pruneExpired();
    const nowMs = this.now();
    const session: ReviewSession = {
      sessionId: randomUUID(),
      assembledPrompt: input.assembledPrompt,
      trackContracts: input.trackContracts,
      createdAtMs: nowMs,
      expiresAtMs: nowMs + Math.max(1, input.ttlMinutes) * 60 * 1000,
      attempt: 0,
      maxAttempts: Math.max(1, input.maxAttempts),
      outputFormat: input.outputFormat,
    };
    this.sessions.set(session.sessionId, session);
    return session;
  }

  lookup(sessionId: string): SessionLookupResult {
    const session = this.sessions.get(sessionId);
    if (!session) return { ok: false, reason: "missing" };
    if (this.isExpired(session)) {
      this.sessions.delete(sessionId);
      return { ok: false, reason: "expired" };
    }
    return { ok: true, session };
  }

  beginValidationAttempt(sessionId: string): BeginValidationResult {
    const lookup = this.lookup(sessionId);
    if (!lookup.ok) return lookup;

    const session = lookup.session;
    if (session.attempt >= session.maxAttempts) {
      return { ok: false, reason: "attempts_exhausted" };
    }

    session.attempt += 1;
    this.sessions.set(sessionId, session);
    return { ok: true, session };
  }

  complete(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  private isExpired(session: ReviewSession): boolean {
    return this.now() >= session.expiresAtMs;
  }

  private pruneExpired(): void {
    for (const [sessionId, session] of this.sessions.entries()) {
      if (this.isExpired(session)) {
        this.sessions.delete(sessionId);
      }
    }
  }
}

export function isoTimestamp(epochMs: number): string {
  return new Date(epochMs).toISOString();
}
