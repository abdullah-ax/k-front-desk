/**
 * Vercel Node function. Four lines of adapting, nothing that can be subtly
 * wrong — see src/server/handler.ts for why there is no framework here.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { handleRequest } from "../src/server/handler.js";
import { proxyChatCompletion, llmSecretOk } from "../src/server/llm-proxy.js";

export const config = { runtime: "nodejs" };

export default async function handler(
  req: IncomingMessage & { body?: unknown; url?: string },
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");

  /**
   * The model proxy streams, and handleRequest does not — it returns a finished
   * body. So this one path is handled before the handler, piping the upstream
   * bytes straight to the socket. Buffering here would defeat the point: the
   * voice provider speaks as tokens arrive, so the first chunk has to leave as
   * soon as it lands, not once the turn is complete.
   *
   * Path: /llm/<secret>/chat/completions — the secret rides in the path because
   * Vapi's custom-llm config has no dependable custom-header field.
   */
  const llm = url.pathname.match(/^\/llm\/([^/]+)\/chat\/completions$/);
  if (llm) {
    if (!llmSecretOk(llm[1])) {
      res.statusCode = 401;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: "unauthorised" }));
      return;
    }
    const result = await proxyChatCompletion(req.body);
    if (!result.stream) {
      res.statusCode = result.status;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: result.error ?? "upstream failed" }));
      return;
    }
    res.statusCode = 200;
    res.setHeader("content-type", "text/event-stream; charset=utf-8");
    res.setHeader("cache-control", "no-cache, no-transform");
    res.setHeader("connection", "keep-alive");
    const reader = result.stream.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    } catch {
      // A caller hanging up mid-turn aborts this read. That is normal and is
      // not worth an error line in the function logs on every short call.
    } finally {
      res.end();
    }
    return;
  }

  const out = await handleRequest({
    method: req.method ?? "GET",
    path: url.pathname,
    headers: req.headers as Record<string, string | string[] | undefined>,
    body: req.body,
    query: url.searchParams,
  });
  res.statusCode = out.status;
  if (out.raw !== undefined) {
    res.setHeader("content-type", out.contentType ?? "text/plain; charset=utf-8");
    // The platform HTML is served from the function rather than as a static
    // file so the passphrase gate cannot be routed around by the host, which
    // means it must not be cached by anything in front of us either.
    res.setHeader("cache-control", "no-store");
    res.end(out.raw);
    return;
  }
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(out.body));
}
