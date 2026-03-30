FROM oven/bun:1-alpine AS base
WORKDIR /app

FROM base AS install
COPY package.json pnpm-workspace.yaml ./
COPY packages/server/package.json packages/server/
RUN bun install

FROM base AS release
COPY --from=install /app/node_modules node_modules
COPY --from=install /app/packages/server/node_modules packages/server/node_modules
COPY packages/server/src packages/server/src
COPY packages/server/package.json packages/server/
COPY packages/server/tsconfig.json packages/server/
COPY tsconfig.base.json ./

ENV NODE_ENV=production
ENV DB_PATH=/data/ccusage-tracker.db
EXPOSE 3000

CMD ["bun", "run", "packages/server/src/index.ts"]
