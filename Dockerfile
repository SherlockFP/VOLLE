FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production
# Keep account data outside the served app directory; mount a volume here.
ENV DATA_DIR=/data
VOLUME /data

COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY . .
# Production bundle (dist/), then drop the build-only devDependencies.
RUN npm run build && npm prune --omit=dev

EXPOSE 10000
CMD ["npm", "start"]
