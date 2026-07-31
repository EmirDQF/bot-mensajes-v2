FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . ./

FROM node:20-alpine AS runner
WORKDIR /app
RUN npm install -g pm2@latest
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app .
ENV NODE_ENV=production
EXPOSE 3000
CMD ["pm2-runtime", "ecosystem.config.js"]
