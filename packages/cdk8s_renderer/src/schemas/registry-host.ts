export const REGISTRY_HOST_PATTERN = '^[A-Za-z0-9._-]+$';

export const REGISTRY_HOST_DESCRIPTION =
  "Registry host without a port. The build and dispatch workflows derive the registry, repository and image tag by splitting the published image reference on ':', so a registry that includes a port yields an empty repository and an unusable image tag, and no dispatch can ever match it. Expose such a registry on the default HTTPS port, or front it with a proxy on 443.";
