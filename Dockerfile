FROM node:24-alpine
WORKDIR /app
COPY package.json *.js ./
COPY public ./public
RUN mkdir -p /app/data && chown -R node:node /app
USER node
ENV HOST=0.0.0.0
EXPOSE 3000
CMD ["node", "server.js"]
