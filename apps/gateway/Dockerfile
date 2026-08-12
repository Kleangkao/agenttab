# AgentTab gateway — local mock control plane (no Mainnet broadcast).
# Build from repo root:
#   docker build -f apps/gateway/Dockerfile -t agenttab-gateway .
#   docker compose up --build
# Run (Windows PowerShell):
#   docker run --rm -p 8787:8787 `
#     -e HOST=0.0.0.0 `
#     -e AGENTTAB_ADMIN_TOKEN=change-me `
#     -v agenttab-data:/data `
#     agenttab-gateway
# Operator UI: http://127.0.0.1:8787/ui
# CLIs in the same image: docker exec <id> node dist/bin/docker-entrypoint.js audit

FROM node:22-bookworm-slim AS build
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@11.16.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages packages
COPY apps/gateway apps/gateway
COPY scripts scripts
COPY examples examples
COPY tools tools

RUN pnpm install --frozen-lockfile --filter @agenttab/gateway... \
  && pnpm --filter @agenttab/core --filter @agenttab/dflow --filter @agenttab/gateway build \
  && pnpm --filter @agenttab/gateway deploy --prod --legacy /out

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8787
ENV AGENTTAB_DB_PATH=/data/gateway.sqlite
ENV AGENTTAB_FUNDING_MODE=mock

RUN mkdir -p /data /policy
COPY --from=build /out /app
COPY --from=build /app/examples/policies/approve.local.json /policy/approve.local.json

ENV AGENTTAB_POLICY_PATH=/policy/approve.local.json
ENV AGENTTAB_GATEWAY_URL=http://127.0.0.1:8787

EXPOSE 8787
VOLUME ["/data"]

HEALTHCHECK --interval=15s --timeout=3s --start-period=8s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Broadcast remains hard-disabled by standalone main.ts.
ENTRYPOINT ["node", "dist/bin/docker-entrypoint.js"]
CMD ["gateway"]
