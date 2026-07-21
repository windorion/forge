import { withStructuredRecovery, StructuredRecoveryError } from "../dist/providerRecovery.js";
import assert from "node:assert";

class FormatError extends Error {}
const opts = (over) => ({
  maxAttempts: 2,
  correctionGuidance: "fix it",
  isFormatError: (e) => e instanceof FormatError,
  compactError: (e) => String(e.message ?? e),
  ...over
});
let passed = 0;
const ok = (c, m) => { assert.ok(c, m); passed++; };

// 1) first-attempt success — no correction, attemptCount 1, not recovered
{
  let seen;
  const r = await withStructuredRecovery(opts({
    produce: async (correction) => { seen = correction; return { v: 1 }; },
    normalize: (raw) => raw.v
  }));
  ok(r.value === 1 && r.attemptCount === 1 && r.recovered === false && seen === undefined, "first-attempt success");
}
// 2) produce throws FormatError once, then succeeds → recovered on attempt 2, correction passed
{
  let calls = 0; let secondCorrection;
  const r = await withStructuredRecovery(opts({
    produce: async (correction) => { calls++; if (calls === 1) throw new FormatError("bad json"); secondCorrection = correction; return { v: 2 }; },
    normalize: (raw) => raw.v
  }));
  ok(r.value === 2 && r.attemptCount === 2 && r.recovered === true, "recover on produce format error");
  ok(secondCorrection && secondCorrection.includes("bad json") && secondCorrection.includes("fix it"), "correction carries error + guidance");
  ok(r.attemptErrors.length === 1 && r.attemptErrors[0] === "bad json", "attemptErrors recorded");
}
// 3) normalize throws once, then succeeds → recovered
{
  let calls = 0;
  const r = await withStructuredRecovery(opts({
    produce: async () => ({ v: ++calls }),
    normalize: (raw) => { if (raw.v === 1) throw new Error("missing field"); return raw.v; }
  }));
  ok(r.value === 2 && r.recovered === true && r.attemptErrors[0] === "missing field", "recover on normalize throw");
}
// 4) exhaustion → StructuredRecoveryError with both errors
{
  let threw = null;
  try {
    await withStructuredRecovery(opts({
      produce: async () => ({}),
      normalize: () => { throw new Error("always bad"); }
    }));
  } catch (e) { threw = e; }
  ok(threw instanceof StructuredRecoveryError && threw.attemptCount === 2 && threw.attemptErrors.length === 2, "exhaustion throws recovery error");
}
// 5) non-format error propagates immediately (no retry, no wrap)
{
  let calls = 0; let threw = null;
  try {
    await withStructuredRecovery(opts({
      produce: async () => { calls++; throw new Error("network down"); },
      normalize: (r) => r
    }));
  } catch (e) { threw = e; }
  ok(threw && threw.message === "network down" && calls === 1 && !(threw instanceof StructuredRecoveryError), "non-format error propagates without retry");
}
// 6) maxAttempts clamped to >= 1
{
  const r = await withStructuredRecovery(opts({ maxAttempts: 0, produce: async () => ({ v: 9 }), normalize: (raw) => raw.v }));
  ok(r.value === 9 && r.attemptCount === 1, "maxAttempts clamped to 1");
}

console.log(`Provider recovery test passed: ${passed} assertions.`);
