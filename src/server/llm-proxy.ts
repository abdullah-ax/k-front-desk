/**
 * An OpenAI-shaped streaming endpoint that Vapi calls instead of OpenRouter.
 *
 * WHY THIS EXISTS. Vapi owns the audio loop on a phone call, so it calls the
 * model itself and our own agent loop is not in the path. That is fine until
 * the one setting that matters cannot be expressed through it: `deepseek-v4-flash`
 * is a reasoning model, and on the live endpoint the first VISIBLE token arrives
 * in 3,339 ms with thinking on and 678 ms with `reasoning: {enabled: false}`.
 * Vapi's OpenRouter integration silently drops that field — a PATCH carrying it
 * comes back with the field gone and no error.
 *
 * The alternative was a faster model, and it was tried twice. `gpt-4.1-mini`
 * (1,082 ms, 4/4 tools) told a caller asking about the COMPRESSOR that "the
 * blower motor is no longer under warranty" and took the red team from 19/19 to
 * 18/19. `ministral-8b` returned 3/4 on tools having been 4/4 a week before.
 * Neither is worth 2.6 seconds.
 *
 * So the model stays and the request is shaped on the way past. This proxy is
 * deliberately almost nothing: it adds one field, forwards, and pipes the bytes
 * back untouched. It does NOT parse the stream, buffer it, or re-serialise it —
 * every one of those would add latency to the thing it exists to make faster,
 * and would be one more place for a token to go missing.
 *
 * Tools are unaffected. Vapi still calls /vapi/tools on this same server; this
 * endpoint only carries the conversation.
 */
import { requireEnv, env } from "../config.js";
import { httpFetch, type ByteStream } from "../http.js";

const UPSTREAM = "https://openrouter.ai/api/v1/chat/completions";

export interface ProxyResult {
  status: number;
  /** Present on success: the upstream SSE body, to pipe straight to the client. */
  stream?: ByteStream | null;
  /** Present on refusal or upstream failure. */
  error?: string;
}

/**
 * Constant-time-ish secret check. The path segment carries it because Vapi's
 * custom-llm configuration has no reliable way to send a custom header, and an
 * unauthenticated endpoint that forwards to a paid model is a bill waiting to
 * happen.
 */
export function llmSecretOk(given: string | undefined): boolean {
  const want = env("VAPI_WEBHOOK_SECRET");
  if (!want || !given || given.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

export async function proxyChatCompletion(body: unknown): Promise<ProxyResult> {
  const req = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;

  const upstreamBody = {
    ...req,
    // The whole reason this file exists.
    reasoning: { enabled: false },
    // Vapi always streams; be explicit rather than trusting the caller, because
    // a non-streamed reply here would mean the caller hears nothing until the
    // entire turn is generated.
    stream: true,
    // Not sampling. See the note in src/agent/loop.ts: at 0.3 the safety gate
    // was unrepeatable across identical runs.
    temperature: 0,
  };

  let res;
  try {
    res = await httpFetch(UPSTREAM, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${requireEnv("OPENROUTER_API_KEY", "A2")}`,
        "Content-Type": "application/json",
        "HTTP-Referer": env("PUBLIC_URL") ?? "http://localhost",
        "X-Title": "Front Desk - Gulf Breeze Air",
      },
      body: JSON.stringify(upstreamBody),
    });
  } catch (err) {
    return { status: 502, error: `upstream unreachable: ${(err as Error).message}` };
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return { status: res.status, error: detail.slice(0, 500) };
  }
  return { status: 200, stream: res.body };
}
