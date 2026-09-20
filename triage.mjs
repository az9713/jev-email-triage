// Email triage with Jev. Run: node --env-file=.env triage.mjs emails.json [--limit N] [--raw] [--resume]
import assert from "node:assert/strict";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { experimental_evaluate as evaluate } from "ai";

export const JEV = "typesafe-ai/jev";
export const QUESTIONS = {
  category: {
    type: "choice",
    instructions: "What kind of email is this, received by the user?",
    criteria: {
      security_alert: "An account security or sign-in notice from a service the user uses",
      receipt: "A payment receipt, invoice, or billing notice",
      service_notice: "A product, policy, or terms change from a service the user uses",
      newsletter: "A digest, marketing, or promotional mailing",
      personal_reminder: "A reminder or task sent by the user or a family member to the user",
      business_inquiry: "A person or company asking the user for work, a contract, or a deal",
      other: "None of the above",
    },
  },
  importance: {
    type: "score",
    instructions: "How important is it that the user personally reads this email? Use today and age_days; an expired deadline is not urgent.",
    criteria: [
      "ignore: no action and no information the user needs",
      "low: informational only; fine to skim later",
      "medium: worth reading this week",
      "high: needs an action or a reply within a few days",
      "critical: needs an action today; money, security, or a deadline is at stake",
      "insane: needs a response within 30 minutes or bad things happen",
    ],
  },
  brand_deal: { type: "boolean", instructions: "Does this email mention a sponsorship or brand deal opportunity for the user?" },
  scam: { type: "boolean", instructions: "Does this email look like a scam, phishing, or something untrustworthy?" },
};

export function outputPath(file) {
  const out = /\.json$/i.test(file) ? file.replace(/\.json$/i, ".triage.json") : `${file}.triage.json`;
  assert.notEqual(resolve(out), resolve(file), "output path must differ from input path");
  return out;
}

export function buildState(email, today = new Date().toISOString().slice(0, 10)) {
  const sent = Date.parse(email.date), now = Date.parse(`${today}T00:00:00Z`);
  return { from: email.from, subject: email.subject, date: email.date, today, age_days: Number.isFinite(sent) ? Math.max(0, Math.floor((now - sent) / 86400000)) : null, snippet: email.snippet };
}

function validateEmail(email) {
  for (const key of ["id", "date", "from", "subject", "snippet"])
    if (typeof email?.[key] !== "string") throw new TypeError(`email.${key} must be a string`);
}

export async function triageOne(email, evaluateFn = evaluate, today) {
  validateEmail(email);
  const ev = await evaluateFn({ model: JEV, state: buildState(email, today), questions: QUESTIONS });
  const a = ev.answers, conf = ev.providerMetadata?.typesafe?.confidence ?? {};
  if (!QUESTIONS.category.criteria[a?.category?.choice] || !Number.isFinite(a?.importance?.score) || ![a?.brand_deal?.probability, a?.scam?.probability].every((p) => Number.isFinite(p) && p >= 0 && p <= 1)) throw new Error("Jev returned an invalid triage answer");
  return {
    row: { id: email.id, date: email.date, from: email.from, subject: email.subject, category: a.category.choice, categoryConf: conf.category ?? null, importance: a.importance.score, importanceConf: conf.importance ?? null, brandDeal: a.brand_deal.probability, scam: a.scam.probability },
    ev,
  };
}

async function atomicWrite(file, value) {
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2));
  await rename(temp, file);
}

function parseArgs(args) {
  let file = null, limit = Infinity;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit") limit = Number(args[++i]);
    else if (!args[i].startsWith("--") && !file) file = args[i];
  }
  if (!file) throw new Error("usage: triage.mjs <emails.json> [--limit N] [--raw] [--resume]");
  if (!(limit > 0)) throw new Error("--limit must be a positive number");
  return { file, limit, raw: args.includes("--raw"), resume: args.includes("--resume") };
}

async function main() {
  const { file, limit, raw, resume } = parseArgs(process.argv.slice(2));
  const parsed = JSON.parse(await readFile(file, "utf8"));
  if (!Array.isArray(parsed)) throw new TypeError("input must be a JSON array");
  const emails = parsed.slice(0, limit), target = outputPath(file), partial = `${target}.partial`;
  let out = [];
  if (resume && limit === Infinity) {
    try { out = JSON.parse(await readFile(partial, "utf8")); } catch (e) { if (e.code !== "ENOENT") throw e; }
  }
  const done = new Set(out.map((r) => r.id));
  for (const email of emails) {
    if (done.has(email.id)) continue;
    const { row, ev } = await triageOne(email);
    if (raw) console.log(JSON.stringify({ answers: ev.answers, meta: ev.providerMetadata }, null, 2));
    out.push(row);
    if (limit === Infinity) await atomicWrite(partial, out);
  }
  if (limit === Infinity) { await atomicWrite(target, out); await rm(partial, { force: true }); }
  const f = (n) => (n == null ? "  -  " : n.toFixed(2));
  console.log("imp  conf  scam  deal  category           date        from                          subject");
  for (const r of [...out].sort((x, y) => y.importance - x.importance))
    console.log(`${f(r.importance)} ${f(r.importanceConf)} ${f(r.scam)} ${f(r.brandDeal)}  ${r.category.padEnd(18)} ${r.date}  ${r.from.slice(0, 28).padEnd(28)}  ${r.subject.slice(0, 60)}`);
}

if (resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? "")) await main();
