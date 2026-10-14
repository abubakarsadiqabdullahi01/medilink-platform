# Multi-stage build. Stage names are referenced by docker-compose.yml targets.
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates postgresql-client curl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# ---- dependencies -----------------------------------------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile

# ---- development (used by docker-compose) -----------------------------------
FROM base AS development
ENV NODE_ENV=development
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm prisma generate
EXPOSE 3000
CMD ["pnpm", "dev"]

# ---- build ------------------------------------------------------------------
FROM base AS build
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm prisma generate && pnpm build

# ---- production runtime -----------------------------------------------------
# One image, three jobs, chosen by the command it is started with:
#
#   web      (default)  node_modules/.bin/next start
#   worker              node_modules/.bin/tsx src/worker/index.ts
#   migrate             node_modules/.bin/prisma migrate deploy
#
# and one command run by hand, once, on a new system - there is nobody to sign
# in as until it has been:
#
#   node_modules/.bin/tsx scripts/create-first-administrator.ts --phone ... --name ...
#
# The worker and the seed import from src/, and tsx needs tsconfig.json to
# resolve '@/'; next start reads next.config.mjs for the security headers. None
# of these was in the image, so the worker could not start from it and the web
# process ran without its headers - and nothing built the image, so nothing
# noticed (see the `image` job in .github/workflows/ci.yml).
#
# pnpm is not used at runtime: corepack would try to download it on first use
# as a user with an empty cache, which fails on a host with no outbound access.
FROM base AS runner
ENV NODE_ENV=production
RUN useradd --uid 10001 --create-home app
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.mjs ./next.config.mjs
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/src ./src
COPY --from=build /app/scripts/docker-entrypoint.sh ./scripts/docker-entrypoint.sh
COPY --from=build /app/scripts/create-first-administrator.ts ./scripts/create-first-administrator.ts
RUN chmod +x ./scripts/docker-entrypoint.sh
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -fsS http://localhost:3000/api/v1/health || exit 1
ENTRYPOINT ["./scripts/docker-entrypoint.sh"]
CMD ["node_modules/.bin/next", "start"]
