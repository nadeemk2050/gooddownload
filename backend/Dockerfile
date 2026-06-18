FROM node:20-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates ffmpeg python3 python-is-python3 && rm -rf /var/lib/apt/lists/*
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production
EXPOSE 4000
CMD ["npm", "run", "start"]
