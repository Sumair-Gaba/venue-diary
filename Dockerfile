# Venue Diary — container image. Pins Node 24 so the built-in node:sqlite
# database works on any container host (Koyeb, Fly, Railway, Cloud Run, etc.)
# regardless of the host's default Node version.
FROM node:24-alpine
WORKDIR /app

# No runtime dependencies (pure Node), but copy manifest first for layer caching.
COPY package*.json ./
RUN npm install --omit=dev || true

COPY . .

# Koyeb and most hosts inject PORT; server.js reads process.env.PORT.
ENV PORT=8000
EXPOSE 8000

CMD ["node", "server.js"]
