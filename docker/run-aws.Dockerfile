FROM ghcr.io/opentofu/opentofu:1.10-minimal AS terraform

FROM node:22-bookworm-slim

ENV KUBECTL_VERSION=1.30
# To see AWS cli available versions: https://raw.githubusercontent.com/aws/aws-cli/v2/CHANGELOG.rst
ENV AWS_CLI_VERSION=2.33.18

COPY --from=terraform /usr/local/bin/tofu /usr/local/bin/tofu

# Install deb dependencies, AWS CLI and kubectl
RUN apt-get update && apt-get install -y \
      apt-transport-https \
      ca-certificates \
      curl \
      gnupg \
      groff \
      unzip \
      less \
      git \
      grep \
    && curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-$(uname -m)-${AWS_CLI_VERSION}.zip" -o "awscliv2.zip" \
    && unzip awscliv2.zip \
    && ./aws/install \
    && rm -rf aws awscliv2.zip \
    && aws --version \
    && mkdir -p /etc/apt/keyrings \
    # Add kubernetes repository for specific version
    && curl -fsSL https://pkgs.k8s.io/core:/stable:/v${KUBECTL_VERSION}/deb/Release.key | gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/v${KUBECTL_VERSION}/deb/ /" | tee /etc/apt/sources.list.d/kubernetes.list \
    && apt-get update \
    # Install kubectl
    && apt-get install -y kubectl \
    && kubectl version --client \
    # Clean up unneeded packages and caches
    && apt-get autoremove -y \
    && npm cache clean --force \
    && rm -rf /root/.cache \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* \
    # Alias terraform → tofu
    && ln -s /usr/local/bin/tofu /usr/local/bin/terraform
