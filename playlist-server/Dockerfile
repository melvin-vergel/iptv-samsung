FROM node:22-alpine

LABEL org.opencontainers.image.source=https://github.com/melvinvergel/samsung-iptv

WORKDIR /app
COPY server.js ./

ENV PORT=8080
EXPOSE 8080

HEALTHCHECK --interval=60s --timeout=10s --start-period=30s \
    CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

USER node
CMD ["node", "server.js"]
