import assert from "node:assert/strict";
import { buildState, outputPath, triageOne } from "./triage.mjs";

const email = { id: "1", date: "2026-09-01", from: "bank@example.com", subject: "New sign-in", snippet: "Review this activity" };
assert.notEqual(outputPath("emails.JSON").toLowerCase(), "emails.json");
assert.equal(outputPath("emails"), "emails.triage.json");
assert.equal(buildState(email, "2026-09-19").age_days, 18);
const fake = async () => ({ answers: { category: { choice: "security_alert" }, importance: { score: 4 }, brand_deal: { probability: 0.01 }, scam: { probability: 0.02 } }, providerMetadata: { typesafe: { confidence: { category: 0.9 } } } });
assert.equal((await triageOne(email, fake, "2026-09-19")).row.category, "security_alert");
console.log("triage checks passed");
