FROM node:22-bookworm AS builder

ENV LERNA="8.1.9"
ENV NCC="0.38.3"
ENV NPM_VERSION="12.2.1"

RUN npm install -g lerna@${LERNA} @vercel/ncc@${NCC} npm@${NPM_VERSION}

WORKDIR /library/

COPY . .

RUN npm ci && \
    NODE_OPTIONS="--max-old-space-size=4096" npm run build --workspace packages/cli

FROM ghcr.io/firestartr-pro/firestartr:run-slim

WORKDIR /library/

COPY --from=builder /library/packages/cli/build /library/

COPY ./scripts/run.sh /library/

RUN chmod a+x run.sh

CMD ["/usr/local/bin/node", "index.js"]
