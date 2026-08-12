FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node swagger.yaml ./swagger.yaml

RUN mkdir -p uploads/images/temp uploads/videos uploads/audios \
  && chown -R node:node /app

USER node

EXPOSE 3000

CMD ["npm", "run", "start:prod"]
