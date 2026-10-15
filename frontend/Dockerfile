# Frontend image: Vite build served by unprivileged nginx. Build context: frontend/
#   docker build -t adv-viz-frontend frontend
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
# Docker Compose and Kubernetes both name the backend service "backend".
ENV BACKEND_URL=http://backend:8000
EXPOSE 8080
