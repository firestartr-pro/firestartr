FROM node:22-bookworm AS builder

ENV LERNA="8.1.9"
ENV NCC="0.38.3"

RUN npm install -g lerna@${LERNA} @vercel/ncc@${NCC}

WORKDIR /library

COPY . .

RUN npm ci \
    ####################################
    # Firestartr transpilation process #
    ####################################
    && NODE_OPTIONS="--max-old-space-size=4096" npm run build --workspace packages/cli \
    && mv packages/operator/external_tsconfig.json packages/operator/tsconfig.json \
    && npm run build-external --workspace packages/operator


FROM ghcr.io/prefapp/gitops-k8s:run-az

WORKDIR /library

##############################
# Copy transpiled firestartr #
##############################
COPY --from=builder /library/packages/cli/build /library/
COPY --from=builder /library/packages/operator/dist_external/index.js /library/external.js
COPY ./scripts/run.sh /library/

RUN chmod a+x run.sh \
    && apt-get update \
    && apt-get install -y vim less jq wget \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* \
    && npm cache clean --force \
    && rm -rf /root/.cache \
    #########################################
    # Prepare permissions for rootless user #
    #########################################
    && chown -R node:node /library \
    # maybe not needed
    && mkdir -p /home/terraform-plugins-cache \
    && chown -R node:node /home/terraform-plugins-cache

USER node

CMD ["/usr/local/bin/node", "index.js"]
