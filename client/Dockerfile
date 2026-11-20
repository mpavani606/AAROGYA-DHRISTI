FROM node:22-alpine AS build
WORKDIR /app
COPY client/package.json ./
RUN npm install
COPY client/ ./
COPY deploy/nginx.conf /etc/nginx/default.conf
ARG VITE_API_URL=/api/v1
ENV VITE_API_URL=${VITE_API_URL}
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY --from=build /etc/nginx/default.conf /etc/nginx/conf.d/default.conf
EXPOSE 80 443
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget --no-check-certificate -qO- https://127.0.0.1/healthz || exit 1
