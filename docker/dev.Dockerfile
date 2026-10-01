FROM ghcr.io/opentofu/opentofu:1.10-minimal AS opentofu

FROM node:22-bookworm

ENV LERNA_VERSION=8.1.9
ENV TSX_VERSION=4.19.3

# Copy the OpenTofu binary and later symlink it to "terraform" to maintain
# backward compatibility with existing scripts/tools that expect a terraform binary.
COPY --from=opentofu /usr/local/bin/tofu /usr/local/bin/tofu

RUN \
    apt update && \
    ln -s /usr/local/bin/tofu /usr/local/bin/terraform && \
    terraform --version &&  \
    npm install -g lerna@${LERNA_VERSION} && \
    npm install -g tsx@${TSX_VERSION} && \
    rm -rf /root/.npm/

WORKDIR /home/app
