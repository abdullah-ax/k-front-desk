/**
 * Task 13 gate — is the number actually callable, and is the endpoint safe?
 *
 * Tests the DEPLOYED webhook over the public internet, not a local server.
 * A local pass proves nothing here: the two failures that actually happened
 * during this build — a serverless adapter returning a shape the runtime never
 * responds to, and a route the host never mapped — were both invisible until
 * the function was live.
 *
 * The security assertion is the one that matters. This endpoint can read entry
 * codes for 869 properties from a public URL. If it ever answers without a
 * valid secret, that is a breach, not a test failure.
 */
import { slugFor } from "../src/models/index.js";
import { env, requireEnv } from "../src/config.js";

interface Row {
  group: string;
  name: string;
  status: "pass" | "fail" | "warn";
  detail: string;
}
const rows: Row[] = [];
const add = (r: Row) => rows.push(r);

const BASE = requireEnv("PUBLIC_URL", "A6").replace(/\/$/, "");
const SECRET = requireEnv("VAPI_WEBHOOK_SECRET", "A6");
const VAPI_KEY = requireEnv("VAPI_API_KEY", "A5");
const NUMBER_ID = requireEnv("VAPI_PHONE_NUMBER_ID", "A5");

async function post(body: unknown, secret?: string, timeoutMs = 45_000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(`${BASE}/vapi/tools`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(secret ? { "x-vapi-secret": secret } : {}),
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function checkDeployed(): Promise<void> {
  try {
    const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(30_000) });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean };
    add({
      group: "Deployment",
      name: "health",
      status: res.ok && body.ok ? "pass" : "fail",
      detail: res.ok ? `${BASE} responding` : `HTTP ${res.status}`,
    });
  } catch (e) {
    add({
      group: "Deployment",
      name: "health",
      status: "fail",
      detail: `unreachable: ${(e as Error).message}`,
    });
  }
}

/**
 * Does the deployment run the model the gates were measured against?
 *
 * This check exists because it did not, and the symptom was not an error. The
 * deployed agent quietly stopped calling the handoff tool on a refusal, which
 * every local gate said it did. A gate result only transfers to production if
 * production runs the same model, so the parity is checked rather than assumed.
 */
async function checkModelParity(): Promise<void> {
  const key = env("APP_PASSPHRASE");
  if (!key) {
    add({
      group: "Deployment",
      name: "model parity",
      status: "warn",
      detail: "APP_PASSPHRASE not set locally — cannot ask the deployment what it runs",
    });
    return;
  }
  try {
    const res = await fetch(`${BASE}/data/config?k=${encodeURIComponent(key)}`, {
      signal: AbortSignal.timeout(30_000),
    });
    const body = (await res.json().catch(() => ({}))) as { models?: Record<string, string> };
    const deployed = body.models ?? {};
    const local = {
      agent: slugFor("MODEL_AGENT"),
      extract: slugFor("MODEL_EXTRACT"),
      judge: slugFor("MODEL_JUDGE"),
    };
    const drift = (Object.keys(local) as (keyof typeof local)[])
      .filter((k) => deployed[k] !== local[k])
      .map((k) => `${k}: deployed ${deployed[k] ?? "unknown"}, gated ${local[k]}`);
    add({
      group: "Deployment",
      name: "model parity",
      status: drift.length ? "fail" : "pass",
      detail: drift.length
        ? drift.join("; ") + " — every gate result was measured against the local one"
        : `deployment runs ${deployed["agent"]}, the model the gates ran against`,
    });
  } catch (e) {
    add({
      group: "Deployment",
      name: "model parity",
      status: "fail",
      detail: `could not ask the deployment: ${(e as Error).message}`,
    });
  }
}

async function checkAuth(): Promise<void> {
  // Three cases, and only the third may succeed.
  const cases: { name: string; secret?: string; want: number }[] = [
    { name: "no secret", secret: undefined, want: 401 },
    { name: "wrong secret", secret: "not-the-secret-at-all-not-even-close", want: 401 },
    { name: "correct secret", secret: SECRET, want: 200 },
  ];

  for (const c of cases) {
    try {
      const res = await post({ message: { type: "tool-calls", toolCalls: [] } }, c.secret);
      add({
        group: "Authentication",
        name: c.name,
        status: res.status === c.want ? "pass" : "fail",
        detail: `HTTP ${res.status} (expected ${c.want})`,
      });
    } catch (e) {
      add({
        group: "Authentication",
        name: c.name,
        status: "fail",
        detail: (e as Error).message,
      });
    }
  }
}

/**
 * Tell the deployment the synthetic call is over.
 *
 * The webhook opens a `call` record on the FIRST message of any conversation,
 * which is what makes a real call observable from its first event. This gate
 * posts a tool call, so it opens one too — and without this it never closed
 * one, so every run left a phantom "live call" on the board header. Three of
 * them were sitting there before anyone noticed.
 */
const TOOL_CALL_ID = `phone-gate-${Date.now()}`;
const AMBIG_CALL_ID = `phone-gate-amb-${Date.now()}`;

async function endSyntheticCall(callId: string): Promise<void> {
  await post({
    message: { type: "end-of-call-report", endedReason: "phone gate", call: { id: callId } },
  }, SECRET, 20_000).catch(() => undefined);
}

async function checkToolCall(): Promise<void> {
  // The real Vapi envelope shape, against a property whose answer we know.
  const payload = {
    message: {
      type: "tool-calls",
      call: { id: TOOL_CALL_ID },
      toolCalls: [
        {
          id: "t1",
          function: {
            name: "resolve_property",
            arguments: JSON.stringify({ address: "1363 West Old Mangrove Road", unit: "3116" }),
          },
        },
      ],
    },
  };

  try {
    const res = await post(payload, SECRET);
    const body = (await res.json()) as { results?: { result?: string }[] };
    const text = body.results?.[0]?.result ?? "";
    const resolved = text.includes("RESOLVED");

    add({
      group: "Tool call over the wire",
      name: "resolve_property",
      status: resolved ? "pass" : "fail",
      detail: resolved ? text.split("\n")[1] ?? "resolved" : `unexpected: ${text.slice(0, 90)}`,
    });

    // The unit must not be echoed twice — streetRaw already contains it, and
    // "unit 3116 unit 3116" is what a caller would hear.
    const doubled = /unit (\S+) unit \1/i.test(text);
    add({
      group: "Tool call over the wire",
      name: "reads back cleanly",
      status: doubled ? "fail" : "pass",
      detail: doubled ? "unit repeated in spoken output" : "no duplicated unit",
    });
  } catch (e) {
    add({
      group: "Tool call over the wire",
      name: "resolve_property",
      status: "fail",
      detail: (e as Error).message,
    });
  }
}

async function checkAmbiguityOverWire(): Promise<void> {
  // The safety behaviour has to survive the network path too: a street with 18
  // units behind it must come back asking for the unit, not resolving.
  const payload = {
    message: {
      type: "tool-calls",
      call: { id: AMBIG_CALL_ID },
      toolCalls: [
        {
          id: "t1",
          function: {
            name: "resolve_property",
            arguments: JSON.stringify({ address: "1363 W Old Mangrove Rd" }),
          },
        },
      ],
    },
  };

  const res = await post(payload, SECRET);
  const body = (await res.json()) as { results?: { result?: string }[] };
  const text = body.results?.[0]?.result ?? "";
  add({
    group: "Tool call over the wire",
    name: "ambiguous address asks for the unit",
    status: text.includes("AMBIGUOUS") ? "pass" : "fail",
    detail: text.split("\n")[0] ?? "(empty)",
  });
}

async function checkAssistantAttached(): Promise<void> {
  try {
    const res = await fetch(`https://api.vapi.ai/phone-number/${NUMBER_ID}`, {
      headers: { Authorization: `Bearer ${VAPI_KEY}` },
      signal: AbortSignal.timeout(30_000),
    });
    const body = (await res.json()) as {
      number?: string;
      assistantId?: string;
      status?: string;
      squadId?: string;
      workflowId?: string;
      assistant?: unknown;
      assistantOverrides?: unknown;
      server?: { url?: string };
    };

    add({
      group: "The number",
      name: "assistant attached",
      status: body.assistantId ? "pass" : "fail",
      detail: body.assistantId ? `${body.number} → ${body.assistantId}` : "no assistant on this number",
    });

    if (body.assistantId) {
      const a = await fetch(`https://api.vapi.ai/assistant/${body.assistantId}`, {
        headers: { Authorization: `Bearer ${VAPI_KEY}` },
        signal: AbortSignal.timeout(30_000),
      });
      const assistant = (await a.json()) as {
        firstMessage?: string;
        model?: { tools?: unknown[]; model?: string; temperature?: number };
      };

      add({
        group: "The number",
        name: "tools published",
        status: (assistant.model?.tools?.length ?? 0) > 0 ? "pass" : "fail",
        detail: `${assistant.model?.tools?.length ?? 0} tool(s) on the assistant`,
      });

      // A browser call from the Vapi dashboard and a dialled call must be the
      // SAME agent, or a rehearsal proves nothing about the number.
      //
      // The dashboard talks to the assistant directly. The number can quietly
      // diverge from it in five ways, each of which would leave the dashboard
      // testing one thing while callers reach another: a squad, a workflow, an
      // inline assistant, per-number overrides, or its own server URL. None is
      // an error, so none would announce itself.
      const overrides = [
        body.squadId ? "squadId" : null,
        body.workflowId ? "workflowId" : null,
        body.assistant ? "inline assistant" : null,
        body.assistantOverrides ? "assistantOverrides" : null,
        body.server?.url ? "server url" : null,
      ].filter(Boolean) as string[];

      add({
        group: "The number",
        name: "dashboard matches the number",
        status: overrides.length ? "fail" : "pass",
        detail: overrides.length
          ? `the number overrides the shared assistant: ${overrides.join(", ")} — a dashboard call would not be the same agent`
          : "no squad, workflow, inline assistant, override or server url on the number",
      });

      // A second assistant with the same name is the quiet version of the same
      // problem: the dashboard shows you one, the number uses the other.
      const all = (await (
        await fetch("https://api.vapi.ai/assistant", {
          headers: { Authorization: `Bearer ${VAPI_KEY}` },
          signal: AbortSignal.timeout(30_000),
        })
      ).json()) as { id: string; name?: string }[];
      const named = all.filter((x) => (x.name ?? "").startsWith("Gulf Breeze Air"));
      // The check that was on the wrong layer.
      //
      // `model parity` above compares the DEPLOYMENT's MODEL_AGENT, which
      // governs the test line and every gate. It says nothing about the phone,
      // because Vapi owns the audio loop and therefore calls the model itself
      // using the assistant's own config. For most of this build those were
      // two different models at two different temperatures and nothing said so.
      const assistantModel = (assistant as {
        model?: { model?: string; temperature?: number; provider?: string; url?: string };
      }).model;
      const wantModel = slugFor("MODEL_AGENT");
      const modelOk = assistantModel?.model === wantModel;
      const tempOk = assistantModel?.temperature === 0;
      add({
        group: "The number",
        name: "phone runs the gated brain",
        status: modelOk && tempOk ? "pass" : "fail",
        detail:
          modelOk && tempOk
            ? `${assistantModel?.model} at temperature 0, the same as every gate`
            : `phone runs ${assistantModel?.model} at temperature ${assistantModel?.temperature}, ` +
              `gates measured ${wantModel} at temperature 0 — the boundary and red-team numbers do not describe this agent`,
      });

      /**
       * The phone no longer calls OpenRouter directly — it calls our own
       * /llm proxy, which adds `reasoning: {enabled: false}` because Vapi
       * silently drops that field and it is worth 4,415 ms -> 1,645 ms to the
       * first token on the real payload.
       *
       * That puts a piece of OUR infrastructure inside the call path, so it is
       * gated like everything else in the call path. If this proxy is
       * unreachable or unauthenticated, every phone call is dead air, and the
       * model-parity check above would still say "pass" because the assistant
       * config is perfectly correct while pointing at nothing.
       */
      if (assistantModel?.provider === "custom-llm") {
        const url = String(assistantModel.url ?? "");
        const publicUrl = (env("PUBLIC_URL") ?? "").replace(/\/$/, "");
        const ours = publicUrl !== "" && url.startsWith(publicUrl);
        add({
          group: "The number",
          name: "the model proxy is ours",
          status: ours ? "pass" : "fail",
          detail: ours
            ? `custom-llm points at ${publicUrl}/llm/***`
            : `custom-llm points at ${url || "(nothing)"} — not this deployment`,
        });

        const endpoint = `${url}/chat/completions`;
        const probe = {
          model: wantModel,
          stream: true,
          messages: [
            { role: "system", content: "Reply with exactly the word: ready" },
            { role: "user", content: "ready?" },
          ],
        };

        // Wrong secret must be refused. An open endpoint that forwards to a
        // paid model is somebody else's bill.
        let refused = false;
        try {
          const bad = await fetch(`${url.replace(/\/[^/]+$/, "/not-the-secret")}/chat/completions`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(probe),
          });
          refused = bad.status === 401;
        } catch {
          refused = false;
        }
        add({
          group: "The number",
          name: "the proxy refuses a wrong secret",
          status: refused ? "pass" : "fail",
          detail: refused ? "HTTP 401" : "a wrong secret was NOT refused",
        });

        // And it must actually stream something back.
        let firstMs = 0;
        let streamed = false;
        try {
          const started = Date.now();
          const res = await fetch(endpoint, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(probe),
          });
          if (res.ok && res.body) {
            const reader = (res.body as ReadableStream<Uint8Array>).getReader();
            const decoder = new TextDecoder();
            let buf = "";
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              buf += decoder.decode(value, { stream: true });
              if (/"content":"[^"]/.test(buf)) {
                firstMs = Date.now() - started;
                streamed = true;
                break;
              }
            }
            await reader.cancel().catch(() => {});
          }
        } catch {
          streamed = false;
        }
        add({
          group: "The number",
          name: "the proxy answers",
          status: streamed ? "pass" : "fail",
          detail: streamed
            ? `first token in ${firstMs} ms`
            : "no content came back — every call would be dead air",
        });
      }

      add({
        group: "The number",
        name: "one assistant, not two",
        status: named.length === 1 && named[0]!.id === body.assistantId ? "pass" : "fail",
        detail:
          named.length === 1
            ? `exactly one "Gulf Breeze Air" assistant, and the number uses it`
            : `${named.length} assistants share the name — the dashboard may open a different one from the number`,
      });

      // Florida is an all-party consent state; the greeting must say so.
      const announces = /record/i.test(assistant.firstMessage ?? "");
      add({
        group: "The number",
        name: "recording announced",
        status: announces ? "pass" : "fail",
        detail: announces
          ? "greeting states the call is recorded"
          : "greeting does not mention recording — Florida requires all-party consent",
      });
    }
  } catch (e) {
    add({ group: "The number", name: "assistant attached", status: "fail", detail: (e as Error).message });
  }
}

async function optionalOutboundCall(): Promise<void> {
  const to = env("TEST_PHONE_NUMBER");
  if (!to) {
    add({
      group: "Live call",
      name: "outbound test",
      status: "warn",
      detail: "TEST_PHONE_NUMBER not set — webhook verified, but no call was placed",
    });
    return;
  }

  try {
    const res = await fetch("https://api.vapi.ai/call", {
      method: "POST",
      headers: { Authorization: `Bearer ${VAPI_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ phoneNumberId: NUMBER_ID, customer: { number: to } }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = (await res.json()) as { id?: string; status?: string };
    add({
      group: "Live call",
      name: "outbound test",
      status: res.ok && body.id ? "pass" : "fail",
      detail: res.ok ? `call ${body.id} placed to ${to}` : `HTTP ${res.status}`,
    });
  } catch (e) {
    add({ group: "Live call", name: "outbound test", status: "fail", detail: (e as Error).message });
  }
}

// --- output ----------------------------------------------------------------

const ICON = { pass: "  ok  ", fail: " FAIL ", warn: " warn " } as const;

await checkDeployed();
await checkModelParity();
await checkAuth();
await checkToolCall();
await checkAmbiguityOverWire();
// Leave no phantom "live call" on the board behind this run.
await endSyntheticCall(TOOL_CALL_ID);
await endSyntheticCall(AMBIG_CALL_ID);
await checkAssistantAttached();
await optionalOutboundCall();

const width = Math.max(...rows.map((r) => r.name.length)) + 2;
console.log("\n  Front Desk — phone\n");
for (const group of [...new Set(rows.map((r) => r.group))]) {
  console.log(`  ${group}`);
  for (const r of rows.filter((x) => x.group === group)) {
    console.log(`   [${ICON[r.status]}] ${r.name.padEnd(width)} ${r.detail}`);
  }
  console.log("");
}

const failed = rows.filter((r) => r.status === "fail");
if (failed.length) {
  console.log(`  ${failed.length} check(s) failed.\n`);
  process.exit(1);
}
console.log(`  The number is live. Dial it.\n`);
process.exit(0);
