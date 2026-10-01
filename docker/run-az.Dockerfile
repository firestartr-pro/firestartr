FROM ghcr.io/opentofu/opentofu:1.12-minimal AS terraform

FROM node:22-bookworm-slim

ENV KUBECTL_VERSION=1.30
ENV AZ_VER=2.63.0

COPY --from=terraform /usr/local/bin/tofu /usr/local/bin/tofu

# Install deb dependencies and azure-cli + kubectl
RUN apt-get update && apt-get install -y \
      apt-transport-https \
      ca-certificates \
      curl \
      gnupg \
      lsb-release \
      git \
      grep \
    && mkdir -p /etc/apt/keyrings \
    # Install azure keyring
    && curl -sLS https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor | tee /etc/apt/keyrings/microsoft.gpg > /dev/null \
    # Add azure repository
    && AZ_DIST=$(lsb_release -cs) \
    && echo "Types: deb\nURIs: https://packages.microsoft.com/repos/azure-cli/\nSuites: ${AZ_DIST}\nComponents: main\nArchitectures: $(dpkg --print-architecture)\nSigned-by: /etc/apt/keyrings/microsoft.gpg" | tee /etc/apt/sources.list.d/azure-cli.sources \
    && apt-get update \
    && curl -fsSL https://pkgs.k8s.io/core:/stable:/v${KUBECTL_VERSION}/deb/Release.key | gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg \
    # Add kubernetes repository for specific version
    && echo "deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/v${KUBECTL_VERSION}/deb/ /" | tee /etc/apt/sources.list.d/kubernetes.list \
    && apt-get update \
    # Install azure-cli and kubectl
    && apt-get install -y azure-cli=${AZ_VER}-1~${AZ_DIST} kubectl \
    # Clean up unneeded packages and caches
    && apt-get autoremove -y \
    && npm cache clean --force \
    && rm -rf /root/.cache \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* \
    # Alias terraform → tofu
    && ln -s /usr/local/bin/tofu /usr/local/bin/terraform
