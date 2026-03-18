FROM node:20-alpine AS build

WORKDIR /app

COPY web/package.json web/package-lock.json* ./
RUN npm install

COPY web ./
RUN npm run build

FROM nginx:stable-alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
