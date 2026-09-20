import { readFile, writeFile } from "node:fs/promises";
import { experimental_evaluate as evaluate } from "ai";
import { triageOne } from "./triage.mjs";

const args = process.argv.slice(2), live = args.includes("--live"), outAt = args.indexOf("--out"), outFile = outAt >= 0 ? args[outAt + 1] : null;
const cases = JSON.parse(await readFile(new URL("./eval/cases.json", import.meta.url), "utf8"));
const offlineEvaluate = async ({ state }) => {
  const text = `${state.subject} ${state.snippet}`.toLowerCase(), old = state.age_days > 30;
  const scam = /password|paypa1|send your/.test(text), brand = /sponsor|brand deal/.test(text);
  const category = /sign-in|security/.test(text) ? "security_alert" : /receipt|invoice/.test(text) ? "receipt" : /terms|maintenance/.test(text) ? "service_notice" : /newsletter|sale/.test(text) ? "newsletter" : /reminder/.test(text) ? "personal_reminder" : /contract|paid project|sponsor/.test(text) ? "business_inquiry" : "other";
  const importance = old ? 1 : scam || /sign-in|security/.test(text) ? 4 : /reminder|contract|paid project|sponsor/.test(text) ? 3 : /receipt|invoice|terms|maintenance/.test(text) ? 1 : 0;
  return { answers: { category: { choice: category }, importance: { score: importance }, brand_deal: { probability: brand ? 0.95 : 0.02 }, scam: { probability: scam ? 0.95 : 0.02 } }, providerMetadata: { gateway: { marketCost: "0" } } };
};
const rows = [];
for (const c of cases) {
  const started = performance.now(), { expected, ...email } = c;
  try {
    const { row, ev } = await triageOne(email, live ? evaluate : offlineEvaluate, "2026-09-19");
    const actual = { category: row.category, importance: row.importance, brandDeal: row.brandDeal >= 0.5, scam: row.scam >= 0.5 };
    const passed = [expected.category].flat().includes(actual.category) && actual.importance >= expected.importance[0] && actual.importance <= expected.importance[1] && actual.brandDeal === expected.brandDeal && actual.scam === expected.scam;
    rows.push({ caseId: c.id, input: email, expected, actual, passed, confidence: { category: row.categoryConf, importance: row.importanceConf }, probabilities: { brandDeal: row.brandDeal, scam: row.scam }, latencyMs: Math.round(performance.now() - started), costUsd: Number(ev.providerMetadata?.gateway?.marketCost ?? 0), attempts: 1, error: null, mode: live ? "live" : "offline" });
  } catch (e) { rows.push({ caseId: c.id, input: email, expected, actual: null, passed: false, confidence: null, probabilities: null, latencyMs: Math.round(performance.now() - started), costUsd: null, attempts: 1, error: String(e.message ?? e), mode: live ? "live" : "offline" }); }
}
const jsonl = rows.map(JSON.stringify).join("\n") + "\n";
if (outFile) await writeFile(outFile, jsonl); else process.stdout.write(jsonl);
const passed = rows.filter((r) => r.passed).length;
console.error(`${passed}/${rows.length} passed; ${rows.filter((r) => r.error).length} errors; $${rows.reduce((n, r) => n + (r.costUsd ?? 0), 0).toFixed(6)}`);
if (!live && passed !== rows.length) process.exitCode = 1;
