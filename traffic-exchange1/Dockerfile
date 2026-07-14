# Multi-stage build producing a small standalone Next.js server image.
FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

# ---- deps: install (uses lockfile when present, falls back on first build) ----
FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci || npm install

# ---- build: generate Prisma client + compile Next ----
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Placeholder secrets so `next build` can import route modules (env.ts validates
# at import time). These are NEVER used at runtime — real values come from the
# env_file at container start. They only need to pass length/inequality checks.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build?schema=public" \
    AUTH_JWT_SECRET="build_time_placeholder_auth_secret_000000" \
    VISIT_TOKEN_SECRET="build_time_placeholder_visit_secret_00000" \
    IP_HASH_SALT="build_time_salt"
RUN npx prisma generate
RUN npm run build

# ---- runtime: minimal standalone output ----
FROM base AS runner
ENV NODE_ENV=production
RUN addgroup -g 1001 nodejs && adduser -u 1001 -G nodejs -S nextjs

# Standalone server + static assets + Prisma engine/schema for migrations.
COPY --from=build /app/public ./public
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma

USER nextjs
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
