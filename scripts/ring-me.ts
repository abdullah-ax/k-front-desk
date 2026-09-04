/**
 * Have the agent call YOU.
 *
 *   pnpm ring +447700900123
 *
 * Why this exists: outbound calling is blocked on some networks and carriers,
 * and a browser-to-phone gateway is a third service to debug at exactly the
 * moment you want to hear the agent. Inbound is a different route entirely and
 * is usually open when outbound is not, so this turns the problem around and
 * has Vapi dial you.
 *
 * It is the SAME assistant that answers the published number: same prompt, same
 * eleven tools, same webhook, same trace. Watch it land on the Calls screen.
 */
import { requireEnv, env } from "../src/config.js";

const number = process.argv[2];
if (!number || !/^\+[1-9]\d{6,14}$/.test(number)) {
  console.error(`
  Usage: pnpm ring +<country code><number>

  E.164 only, so +447700900123 rather than 07700 900123.
  The number must be one you can answer right now.
`);
  process.exit(1);
}

const key = requireEnv("VAPI_API_KEY", "A5");
const phoneNumberId = requireEnv("VAPI_PHONE_NUMBER_ID", "A5");
const assistantId = env("VAPI_ASSISTANT_ID");

async function main(): Promise<number> {
  // Resolve the assistant by name if the id is not pinned in the environment,
  // so this keeps working after a re-provision.
  let id = assistantId;
  if (!id) {
    const res = await fetch("https://api.vapi.ai/assistant", {
      headers: { Authorization: `Bearer ${key}` },
    });
    const list = (await res.json()) as { id: string; name: string }[];
    id = list.find((a) => a.name.startsWith("Gulf Breeze Air"))?.id;
  }
  if (!id) {
    console.error("  No assistant found. Run `pnpm provision:vapi` first.");
    return 1;
  }

  const res = await fetch("https://api.vapi.ai/call", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      assistantId: id,
      phoneNumberId,
      customer: { number },
    }),
  });
  const body = await res.text();

  if (!res.ok) {
    console.error(`\n  Vapi refused the call (${res.status}):\n  ${body.slice(0, 400)}\n`);
    // The common causes, named, because the error text alone is rarely enough.
    if (/not.*allowed|region|country|geo/i.test(body)) {
      console.error("  That destination is likely not enabled on the Vapi number's country permissions.");
    }
    return 1;
  }

  const call = JSON.parse(body) as { id: string; status: string };
  console.log(`
  Calling ${number} now.

  call id   ${call.id}
  status    ${call.status}
  watch it  open Calls on the platform; the turns appear as they are spoken

  Answer it and try: "This is Saltmarsh Hospitality, when were you last out at
  7 Grouper Shores Circle?"
`);
  return 0;
}

process.exit(await main());
