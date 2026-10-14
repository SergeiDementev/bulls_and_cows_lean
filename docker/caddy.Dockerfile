# Caddy with the built Mini App inside: Node and the sources stay in the build stage.
FROM public.ecr.aws/docker/library/node:24-alpine AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json vite.config.ts ./
COPY locales ./locales
COPY src ./src
# For the "Open the bot" link on a page opened outside Telegram
ARG BOT_USERNAME=""
ENV VITE_BOT_USERNAME=${BOT_USERNAME}
RUN pnpm build

FROM public.ecr.aws/docker/library/caddy:2.10-alpine
COPY docker/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist/web /srv/web
