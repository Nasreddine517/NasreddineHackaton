FROM node:20.19.5-bookworm-slim AS build
WORKDIR /app
RUN npm install --global pnpm@10.26.1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsup.config.ts ./
COPY apps ./apps
COPY packages ./packages
COPY tests ./tests
RUN pnpm build

FROM build AS production-deps
RUN pnpm prune --prod

FROM node:20.19.5-bookworm-slim AS server
ENV NODE_ENV=production
WORKDIR /app
COPY --from=production-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist/server ./dist/server
COPY --chown=node:node package.json ./
COPY --chown=node:node db ./db
COPY --chown=node:node Data/seed ./Data/seed
USER node
EXPOSE 3000
CMD ["node", "dist/server/api.js"]

FROM nginx:1.28-alpine AS web
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/web /usr/share/nginx/html
EXPOSE 80
