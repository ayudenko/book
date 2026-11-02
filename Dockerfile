FROM node:24-bookworm-slim AS verify
WORKDIR /app
COPY package.json server.mjs ./
COPY backend ./backend
COPY dist ./dist
COPY scripts ./scripts
COPY test ./test
RUN npm run check && npm test

FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends gosu ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=verify /app/package.json /app/server.mjs ./
COPY --from=verify /app/backend ./backend
COPY --from=verify /app/dist ./dist
COPY --from=verify /app/scripts ./scripts
COPY deploy/entrypoint.sh /usr/local/bin/book-entrypoint
RUN chmod 755 /usr/local/bin/book-entrypoint && mkdir -p /data
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4000 DATABASE_PATH=/data/quiet-chapter.sqlite
EXPOSE 4000
ENTRYPOINT ["book-entrypoint"]
CMD ["node", "server.mjs"]
