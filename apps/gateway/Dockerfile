# AgentTab gateway — local mock control plane (no Mainnet broadcast).
# Build from repo root:
#   docker build -f apps/gateway/Dockerfile -t agenttab-gateway .
# Run (Windows PowerShell):
#   docker run --rm -p 8787:8787 `
#     -e HOST=0.0.0.0 `
#     -e AGENTTAB_POLICY_PATH=/policy/approve.local.json `
#     -e AGENTTAB_POLICY_REPLACE=1 `
#     -v "${PWD}/examples/policies:/policy:ro" `
#     -v agenttab-data:/data `
#     agenttab-gateway

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

RUN mkdir -p /data
COPY --from=build /out /app

EXPOSE 8787
VOLUME ["/data"]

# Broadcast remains hard-disabled by standalone main.ts.
CMD ["node", "dist/main.js"]
