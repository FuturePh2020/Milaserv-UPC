# syntax=docker/dockerfile:1
FROM node:20-slim AS base
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile=false

FROM deps AS build
COPY packages/shared packages/shared
COPY packages/ui packages/ui
COPY apps/api apps/api
RUN pnpm --filter @lcrm/shared build \
  && pnpm --filter @lcrm/ui build \
  && pnpm --filter @lcrm/api prisma:generate \
  && pnpm --filter @lcrm/api build

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo/pnpm-workspace.yaml /repo/package.json ./
COPY --from=build /repo/packages/shared/package.json packages/shared/package.json
COPY --from=build /repo/packages/shared/dist packages/shared/dist
COPY --from=build /repo/packages/ui/package.json packages/ui/package.json
COPY --from=build /repo/packages/ui/dist packages/ui/dist
COPY --from=build /repo/apps/api/package.json apps/api/package.json
COPY --from=build /repo/apps/api/dist apps/api/dist
COPY --from=build /repo/apps/api/prisma apps/api/prisma
RUN pnpm install --prod --frozen-lockfile=false --filter @lcrm/api...
RUN pnpm --filter @lcrm/api prisma:generate

WORKDIR /repo/apps/api
EXPOSE 4000
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/main.js"]
