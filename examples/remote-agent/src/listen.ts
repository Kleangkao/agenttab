import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";

type FetchApp = {
  fetch: (request: Request) => Response | Promise<Response>;
};

export async function listenApp(
  app: FetchApp
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = serve({
    fetch: (request) => app.fetch(request),
    port: 0,
    hostname: "127.0.0.1"
  });

  if (!server.listening) {
    await new Promise<void>((resolve, reject) => {
      server.once("listening", () => resolve());
      server.once("error", reject);
    });
  }

  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  };
}
