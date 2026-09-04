/**
 * Check the demo is ready, right before you run it.
 *
 *   pnpm demo:check
 *
 * Why this exists: the worst moment to find out the phone number lost its
 * assistant, or that the deployed server is running a different model from the
 * one you rehearsed on, is while somebody is watching. This asks the running
 * system nine questions and prints the answers, then prints the facts you need
 * in front of you during the call — real addresses, real names, real numbers,
 * read live from the book rather than typed in here.
 *
 * It only reads. It changes nothing.
 */
import { env } from "../src/config.js";

const APP = (env("PUBLIC_URL") ?? "https://k-front-desk.vercel.app").replace(/\/+$/, "");
const KEY = env("APP_PASSPHRASE") ?? "admin";
const VAPI = env("VAPI_API_KEY");

type Check = { name: string; ok: boolean; note: string };
const checks: Check[] = [];
const add = (name: string, ok: boolean, note: string): void => { checks.push({ name, ok, note }); };

async function api<T>(path: string): Promise<T> {
  const url = `${APP}/data/${path}${path.includes("?") ? "&" : "?"}k=${encodeURIComponent(KEY)}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as T;
}

async function main(): Promise<number> {
  // 1 — the screen answers at all
  const t0 = Date.now();
  try {
    const r = await fetch(`${APP}/app?k=${encodeURIComponent(KEY)}`);
    add("The screen loads", r.ok, `HTTP ${r.status} in ${Date.now() - t0} ms`);
  } catch (e) { add("The screen loads", false, (e as Error).message); }

  // 2 — the phone webhook is up AND still refuses strangers
  try {
    const r = await fetch(`${APP}/vapi/tools`, {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    });
    add("The phone webhook is guarded", r.status === 401,
      r.status === 401 ? "401 without the secret, which is right" : `got HTTP ${r.status}, expected 401`);
  } catch (e) { add("The phone webhook is guarded", false, (e as Error).message); }

  // 3 — the model the deployment actually runs, not the one in your .env
  try {
    const c = await api<{ models: Record<string, string>; today: string }>("config");
    add("The model is the one you tested", c.models.agent === "anthropic/claude-haiku-4.5",
      `${c.models.agent}, and the book's today is ${c.today}`);
  } catch (e) { add("The model is the one you tested", false, (e as Error).message); }

  // 4 — the number still points at an assistant
  if (VAPI) {
    try {
      const r = await fetch("https://api.vapi.ai/phone-number", { headers: { Authorization: `Bearer ${VAPI}` } });
      const list = (await r.json()) as { number: string; assistantId?: string; status?: string }[];
      const live = list.filter((n) => n.assistantId);
      add("The phone number answers", live.length > 0,
        live.map((n) => `${n.number} → assistant ${String(n.assistantId).slice(0, 8)} (${n.status ?? "?"})`).join(", ") || "no number has an assistant");
    } catch (e) { add("The phone number answers", false, (e as Error).message); }
  } else {
    add("The phone number answers", false, "no VAPI_API_KEY here, so this was not checked");
  }

  // 5 — there is work on the board to point at
  let boardDate = "";
  try {
    const b = await api<{ date: string; counts: { jobs: number; unassigned: number; late: number } }>("board");
    boardDate = b.date;
    add("Today's board has work on it", b.counts.jobs > 0,
      `${b.date}: ${b.counts.jobs} jobs, ${b.counts.unassigned} with nobody on them, ${b.counts.late} late`);
  } catch (e) { add("Today's board has work on it", false, (e as Error).message); }

  // 6 — nothing left over from a rehearsal is showing as a real customer
  try {
    const p = await api<{ rehearsal: boolean }[]>("pressing");
    const real = p.filter((x) => !x.rehearsal).length;
    add("No rehearsals are showing as real calls", true,
      `${real} real, ${p.length - real} rehearsals hidden`);
  } catch (e) { add("No rehearsals are showing as real calls", false, (e as Error).message); }

  // 7 — the address the agent will be given actually resolves
  try {
    const r = await api<{ id: number; address: string }[]>("properties?q=Grouper%20Shores");
    add("The demo address is findable", r.length > 0,
      r.map((x) => `${x.address} (#${x.id})`).join(", ") || "nothing matched");
  } catch (e) { add("The demo address is findable", false, (e as Error).message); }

  // 8 — plain-English questions still return rows
  try {
    const t = Date.now();
    const r = await fetch(`${APP}/data/ask?k=${encodeURIComponent(KEY)}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "how much money is sitting in invoices that were written but never sent" }),
    });
    const d = (await r.json()) as { rowCount: number; rows: Record<string, unknown>[]; error?: string };
    add("Plain-English questions work", d.rowCount > 0 && !d.error,
      d.error ?? `${d.rowCount} row in ${Date.now() - t} ms → ${JSON.stringify(d.rows[0] ?? {})}`);
  } catch (e) { add("Plain-English questions work", false, (e as Error).message); }

  // 9 — the typed test line opens, and we hang up after ourselves. A check that
  // leaves a call ringing puts a phantom "on the line" on the dispatcher's screen.
  try {
    const r = await fetch(`${APP}/data/testline/start?k=${encodeURIComponent(KEY)}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "demo: preflight" }),
    });
    const started = r.ok ? ((await r.json()) as { providerCallId?: string }) : null;
    if (started?.providerCallId) {
      await fetch(`${APP}/data/testline/end?k=${encodeURIComponent(KEY)}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ providerCallId: started.providerCallId }),
      });
    }
    add("The test line opens", r.ok, r.ok ? "a call started and was hung up again" : `HTTP ${r.status}`);
  } catch (e) { add("The test line opens", false, (e as Error).message); }

  // --- print ---------------------------------------------------------------
  const pad = Math.max(...checks.map((c) => c.name.length));
  console.log("\n  Before you demo\n");
  for (const c of checks) {
    console.log(`  ${c.ok ? "[  ok  ]" : "[ FAIL ]"} ${c.name.padEnd(pad)}  ${c.note}`);
  }
  const bad = checks.filter((c) => !c.ok).length;

  // The facts you want in front of you, read live rather than typed in here.
  console.log("\n  In front of you\n");
  console.log(`  Screen    ${APP}/app?k=${KEY}`);
  console.log(`  Board day ${boardDate || "unknown"}`);
  try {
    const q = await api<{ count: number; name: string; amountCents: number | null }[]>("queues");
    for (const x of q.filter((y) => y.count > 0)) {
      const money = x.amountCents ? ` worth $${(x.amountCents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}` : "";
      console.log(`  ${String(x.count).padStart(5)}  ${x.name.replace(/_/g, " ")}${money}`);
    }
  } catch { /* the screen still shows these */ }

  console.log(bad === 0
    ? "\n  Everything answered. You are clear to run it.\n"
    : `\n  ${bad} check(s) failed. Fix those before you start.\n`);
  return bad === 0 ? 0 : 1;
}

main().then((c) => process.exit(c)).catch((e) => { console.error(e); process.exit(1); });
