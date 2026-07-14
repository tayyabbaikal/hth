// Unit tests for the visit-token signing/verification core.
import { describe, it, expect } from "vitest";
import { signVisitToken, verifyVisitToken, newJti } from "../tokens";

function payload(overrides: Partial<Parameters<typeof signVisitToken>[0]> = {}) {
  return {
    jti: newJti(),
    c: "campaign_1",
    v: "viewer_1",
    exp: Math.floor(Date.now() / 1000) + 600,
    ...overrides,
  };
}

describe("visit tokens", () => {
  it("round-trips a valid token", () => {
    const p = payload();
    const token = signVisitToken(p);
    const res = verifyVisitToken(token);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.payload).toEqual(p);
  });

  it("rejects a tampered payload", () => {
    const token = signVisitToken(payload());
    const [body, sig] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...payload(), v: "attacker" }),
    ).toString("base64url");
    const res = verifyVisitToken(`${forged}.${sig}`);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("BAD_SIGNATURE");
  });

  it("rejects an expired token", () => {
    const token = signVisitToken(payload({ exp: Math.floor(Date.now() / 1000) - 1 }));
    const res = verifyVisitToken(token);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("EXPIRED");
  });

  it("rejects a malformed token", () => {
    expect(verifyVisitToken("not-a-token").ok).toBe(false);
    expect(verifyVisitToken("a.b.c").ok).toBe(false);
  });
});
