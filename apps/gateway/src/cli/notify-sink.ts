#!/usr/bin/env node
/**
 * Local webhook sink for AGENTTAB_NOTIFY_URL.
 *
 *   pnpm notify:sink
 *   AGENTTAB_NOTIFY_URL=http://127.0.0.1:8792/hook
 *
 * If AGENTTAB_NOTIFY_SECRET is set, unsigned or bad signatures are rejected.
 */
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import {
  NOTIFY_SIGNATURE_HEADER,
  verifyNotifySignature
} from "../notify.js";

const port = Number(process.env.AGENTTAB_NOTIFY_SINK_PORT ?? process.env.PORT ?? "8792");
const host = process.env.HOST ?? "127.0.0.1";
const secret = process.env.AGENTTAB_NOTIFY_SECRET?.trim();

const app = new Hono();
app.get("/health", (c) =>
  c.json({
    ok: true,
    service: "agenttab-notify-sink",
    verifySignatures: secret !== undefined && secret.length > 0
  })
);

const receive = async (c: { req: { text: () => Promise<string>; header: (name: string) => string | undefined } }) => {
  const body = await c.req.text();
  if (secret !== undefined && secret.length > 0) {
    if (!verifyNotifySignature(body, c.req.header(NOTIFY_SIGNATURE_HEADER), secret)) {
      console.error(JSON.stringify({ phase: "notify-sink-reject", reason: "bad_signature" }));
      return Response.json({ error: "bad_signature" }, { status: 401 });
    }
  }
  let parsed: unknown = body;
  try {
    parsed = JSON.parse(body);
  } catch {
    /* keep raw */
  }
  console.log(
    JSON.stringify({ phase: "notify-sink", at: new Date().toISOString(), body: parsed }, null, 2)
  );
  return new Response(null, { status: 204 });
};

app.post("/", (c) => receive(c));
app.post("/hook", (c) => receive(c));

serve({ fetch: app.fetch, port, hostname: host }, (info) => {
  console.log(
    JSON.stringify(
      {
        phase: "notify-sink-listen",
        url: `http://${host}:${info.port}/hook`,
        verifySignatures: secret !== undefined && secret.length > 0,
        next: `AGENTTAB_NOTIFY_URL=http://${host}:${info.port}/hook`
      },
      null,
      2
    )
  );
});
