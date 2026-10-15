# The server. Node 24 runs the TypeScript sources directly (type stripping): no build step.
FROM public.ecr.aws/docker/library/node:24-alpine AS deps
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

FROM public.ecr.aws/docker/library/node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src/shared ./src/shared
COPY src/domain ./src/domain
COPY src/server ./src/server
COPY src/locales ./src/locales
COPY scripts/bot-setup.ts ./scripts/
USER node
CMD ["node", "src/server/main.ts"]
