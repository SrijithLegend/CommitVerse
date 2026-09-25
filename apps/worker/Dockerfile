# Fly.io / Railway image for the Commitverse worker
FROM node:22-slim
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile --filter @commitverse/worker...
ENV NODE_ENV=production SERVICE_NAME=worker
EXPOSE 8080
CMD ["pnpm", "--filter", "@commitverse/worker", "start"]
