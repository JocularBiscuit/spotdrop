# ---- build the React frontend ----
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- runtime ----
FROM node:24-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-eng tesseract-ocr-deu tesseract-ocr-fra \
    tesseract-ocr-ita tesseract-ocr-spa tesseract-ocr-por ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=5280 SPOTDROP_DATA=/data TESSERACT_LANGS=eng+deu+fra+ita+spa+por
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY shared ./shared
COPY --from=build /app/web/dist ./web/dist
VOLUME /data
EXPOSE 5280
CMD ["node", "server/index.ts"]
