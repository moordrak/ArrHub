FROM node:22-alpine

ARG VERSION=dev
LABEL org.opencontainers.image.title="ArrHub" \
      org.opencontainers.image.description="One dashboard for Radarr, Sonarr, NZBGet, qBittorrent and Seerr" \
      org.opencontainers.image.source="https://github.com/moordrak/arrhub" \
      org.opencontainers.image.version="${VERSION}"

WORKDIR /app
COPY package.json server.js ./
COPY public ./public
RUN mkdir -p /app/data && chown node:node /app/data

ENV NODE_ENV=production \
    PORT=8686 \
    ARRHUB_CONFIG=/app/data/config.json
EXPOSE 8686
VOLUME /app/data
USER node

# 401 also counts as healthy (login enabled)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/config').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
