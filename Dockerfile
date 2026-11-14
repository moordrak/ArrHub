FROM node:22-alpine
WORKDIR /app
COPY server.js ./
COPY public ./public
ENV PORT=8686
EXPOSE 8686
USER node
CMD ["node", "server.js"]
