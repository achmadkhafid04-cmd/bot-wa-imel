FROM node:20-alpine

WORKDIR /app

# Tidak perlu Chromium — bot pakai FSN API (HTTP request saja)
COPY package*.json ./
RUN npm install --production

COPY . .

EXPOSE 8080

CMD ["node", "index.js"]
