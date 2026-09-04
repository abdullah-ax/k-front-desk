/** Local dev server, same handler the deployment uses. */
import { createServer } from "node:http";
import { handleRequest } from "./handler.js";

const port = Number(process.env["PORT"] ?? 3000);
createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString();
  const url = new URL(req.url ?? "/", "http://localhost");
  const out = await handleRequest({
    method: req.method ?? "GET",
    path: url.pathname,
    headers: req.headers as Record<string, string | string[] | undefined>,
    body: raw ? JSON.parse(raw) : undefined,
    query: url.searchParams,
  });
  res.statusCode = out.status;
  if (out.raw !== undefined) {
    res.setHeader("content-type", out.contentType ?? "text/plain; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    res.end(out.raw);
    return;
  }
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(out.body));
}).listen(port, () => console.log(`front-desk dev server on :${port}`));
