import { describe, expect, it } from "vitest";
import { createGatewayRuntime } from "../src/app.js";
import {
  GATEWAY_OPENAPI_PATHS,
  gatewayOpenApiDocument,
  honoPathToOpenApi
} from "../src/openapi.js";

describe("gateway OpenAPI contract", () => {
  it("documents every live Hono route and serves /openapi.json", async () => {
    const gateway = createGatewayRuntime({
      merchantOrigin: "http://127.0.0.1:8791"
    });
    try {
      const live = new Set(
        gateway.app.routes
          .filter((route) => route.path !== "/*")
          .map((route) => `${route.method.toUpperCase()} ${honoPathToOpenApi(route.path)}`)
      );
      const documented = new Set<string>();
      for (const [path, methods] of Object.entries(GATEWAY_OPENAPI_PATHS)) {
        for (const method of ["get", "post", "put"] as const) {
          if (methods[method] !== undefined) {
            documented.add(`${method.toUpperCase()} ${path}`);
          }
        }
      }

      const missingFromSpec = [...live].filter((row) => !documented.has(row));
      const extraInSpec = [...documented].filter((row) => !live.has(row));
      expect(missingFromSpec, "live routes missing from OpenAPI").toEqual([]);
      expect(extraInSpec, "OpenAPI paths with no live route").toEqual([]);

      const response = await gateway.app.request("/openapi.json");
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        openapi: string;
        paths: Record<string, unknown>;
      };
      expect(body.openapi).toBe("3.1.0");
      expect(Object.keys(body.paths)).toEqual(Object.keys(gatewayOpenApiDocument().paths as object));

      const health = await (await gateway.app.request("/health")).json();
      expect(health).toMatchObject({ openapi: "/openapi.json" });
    } finally {
      gateway.close();
    }
  });
});
