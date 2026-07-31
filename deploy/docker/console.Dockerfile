# HoursX console image — Next.js standalone output.
FROM node:22-alpine AS builder
WORKDIR /app
COPY console/package.json console/package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY console/ ./
# Baked at build time: Next.js inlines NEXT_PUBLIC_* into the client bundle.
ARG NEXT_PUBLIC_HOURSX_API_URL=http://localhost:8400
ENV NEXT_PUBLIC_HOURSX_API_URL=$NEXT_PUBLIC_HOURSX_API_URL
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=3400
RUN addgroup -g 10001 hoursx && adduser -u 10001 -G hoursx -D hoursx

COPY --from=builder --chown=hoursx:hoursx /app/.next/standalone ./
COPY --from=builder --chown=hoursx:hoursx /app/.next/static ./.next/static
COPY --from=builder --chown=hoursx:hoursx /app/public ./public

USER hoursx
EXPOSE 3400
CMD ["node", "server.js"]
