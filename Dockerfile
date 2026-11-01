# Sinestesia: one small Node process serves the app and the duet's rooms.
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production PORT=3000

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server ./server
COPY public ./public

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "server/server.js"]
