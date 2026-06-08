# syntax=docker/dockerfile:1

# CSquared CMS — multi-stage build.
# Targets:
#   runner  (default) — minimal Next.js standalone server image for Cloud Run.
#   migrate           — one-shot image that runs `prisma migrate deploy` (separate step).
#
# Build the serving image:   docker build -t csquared-cms .
# Build the migration image: docker build --target migrate -t csquared-cms-migrate .

# ---- base: shared toolchain (Node 22 LTS + pnpm via corepack) ----
FROM node:22-alpine AS base
# libc6-compat: native addon compatibility on Alpine. openssl: required by Prisma.
RUN apk add --no-cache libc6-compat openssl
# corepack activates the pnpm version pinned in package.json (packageManager field).
RUN corepack enable
WORKDIR /app

# ---- deps: install all dependencies (postinstall runs `prisma generate`) ----
FROM base AS deps
# prisma schema + config must be present before install so the postinstall
# `prisma generate` hook succeeds. pnpm-workspace.yaml carries the allowBuilds
# approvals — without it pnpm errors with ERR_PNPM_IGNORED_BUILDS in CI/non-TTY.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml prisma.config.ts ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile

# ---- builder: compile the Next.js standalone bundle ----
FROM base AS builder
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

# ---- migrate: one-shot image for `prisma migrate deploy` (run as a separate step) ----
# Needs the prisma CLI (node_modules), schema, migrations, and prisma.config.ts
# (which reads DATABASE_URL from the environment at run time).
FROM base AS migrate
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml prisma.config.ts ./
COPY prisma ./prisma
CMD ["pnpm", "prisma", "migrate", "deploy"]

# ---- runner: minimal production serving image (default target) ----
FROM base AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=8080 \
    HOSTNAME=0.0.0.0
# Serve as the unprivileged `node` user that ships with the base image.
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
USER node
# Cloud Run injects $PORT (defaults to 8080); server.js honours PORT + HOSTNAME.
EXPOSE 8080
CMD ["node", "server.js"]
