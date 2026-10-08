FROM node:22-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

COPY server/package*.json ./
RUN npm install --omit=dev

COPY server/ ./
RUN mkdir -p /app/uploads && chown -R node:node /app

USER node
EXPOSE 3000
CMD ["node", "server.js"]