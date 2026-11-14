FROM node:22-alpine
WORKDIR /app
COPY server.js ./
COPY public ./public
RUN mkdir -p /app/data && chown node:node /app/data
ENV PORT=8686 ARRHUB_CONFIG=/app/data/config.json
EXPOSE 8686
USER node
VOLUME /app/data
CMD ["node", "server.js"]
