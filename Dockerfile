FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json ./
RUN npm install --omit=dev

COPY . .

EXPOSE 10000
CMD ["npm", "start"]
