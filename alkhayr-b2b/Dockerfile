# syntax=docker/dockerfile:1.7
# ALKHAYR B2B — production image (stage 17).
# Multi-stage: dependencies are installed from package-lock.json (npm ci) and the app is built in the build
# stage (node 24.22.3 — Node.js security release of 2026-11-10); the runtime stage contains only the Node runtime,
# the built bundles, migrations and licenses. No shell, npm, node_modules, sources, tests or secrets. Runs as uid 1000.
ARG NODE_IMAGE=node:24.22.3-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54
ARG RUNTIME_IMAGE=gcr.io/distroless/nodejs24-debian13:nonroot@sha256:6abfcb367ebc291572c774c1592a986be2ab26a2486f73093401327495a5962a

FROM ${NODE_IMAGE} AS build
WORKDIR /src
COPY package.json package-lock.json ./
# Optional extra CA (build secret, never stored in a layer) for build hosts behind a TLS-inspecting proxy:
#   docker build --secret id=extra_ca,src=/path/to/ca.crt …   (TLS verification stays ON; omit elsewhere)
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -s /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi; \
    npm ci --no-audit --no-fund --ignore-scripts
COPY tsconfig.json tsconfig.server.json tsconfig.web.json ./
COPY scripts ./scripts
COPY src ./src
COPY public ./public
COPY assets ./assets
COPY migrations ./migrations
COPY licenses ./licenses
RUN node scripts/build.mjs && find dist -name '*.map' -delete \
 && mkdir -p /out/data /out/backups && chmod 0700 /out/data /out/backups

# Runtime: Google distroless Node.js 24 on Debian 13 (no shell, no package manager, no coreutils/util-linux),
# pinned by digest; it ships Node v24.22.3 (verified with `node -v` when the digest was chosen).
FROM ${RUNTIME_IMAGE} AS runtime
ARG ALKHAYR_VERSION=dev
LABEL org.opencontainers.image.title="alkhayr-b2b" org.opencontainers.image.version="${ALKHAYR_VERSION}"
WORKDIR /app
COPY --from=build --chown=0:0 /src/dist ./dist
COPY --from=build --chown=0:0 /src/migrations ./migrations
COPY --from=build --chown=0:0 /src/licenses ./licenses
COPY --chown=0:0 package.json ./
# Writable locations: data and backups only (0700, uid 1000), normally replaced by mounted volumes.
COPY --from=build --chown=1000:1000 --chmod=0700 /out/data /data
COPY --from=build --chown=1000:1000 --chmod=0700 /out/backups /backups
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATA_DIR=/data BACKUP_DIR=/backups ALKHAYR_VERSION=${ALKHAYR_VERSION}
USER 1000:1000
EXPOSE 3000
STOPSIGNAL SIGTERM
# Liveness only (process answers). Readiness / write safety is NOT a restart condition (see ops:status).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["/nodejs/bin/node", "-e", "const u=new URL(process.env.APP_ORIGIN);require('http').get({host:'127.0.0.1',port:process.env.PORT||3000,path:'/healthz',headers:{host:u.host},timeout:4000},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"]
ENTRYPOINT ["/nodejs/bin/node", "dist/server/main.js"]
