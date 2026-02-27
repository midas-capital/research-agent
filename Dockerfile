# 事例調査エージェント - 本番用
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev
COPY --from=builder /app/dist ./dist
# 永続化用（ホストやボリュームでマウントする）
RUN mkdir -p /app/data/runs /app/output
ENV DATA_DIR=/app/data
ENV OUTPUT_DIR=/app/output
EXPOSE 3000
CMD ["node", "dist/server.js"]
