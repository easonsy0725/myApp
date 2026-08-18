FROM node:18-alpine

RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package*.json ./
RUN npm install --only=production

COPY . .

RUN mkdir -p /app/data

EXPOSE 3000

ENV PORT=3000
ENV DB_PATH=/app/data/omniflow.db

CMD ["node", "server.js"]