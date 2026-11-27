FROM node:24-trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends libreoffice-impress python3-uno python3-pymupdf fonts-noto-cjk && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --chown=node:node dist ./dist
COPY --chown=node:node server.mjs static-assets.mjs room-store.mjs room-broadcast.mjs lesson-provider.mjs lecture-quick-provider.mjs material-import.mjs experiment-peer.mjs media-search.mjs reference-lookup.mjs public-https.mjs AGENT.md ./
COPY --chown=node:node tools/material-import-*.py ./tools/
RUN mkdir /data && chown node:node /data
ENV HOST=0.0.0.0 PORT=4188 POLYPHONY_ROOM_FILE=/data/rooms.json
ENV POLYPHONY_PDF_PYTHON=/usr/bin/python3 POLYPHONY_LIBREOFFICE_PYTHON=/usr/bin/python3
USER node
EXPOSE 4188
CMD ["node", "server.mjs"]
