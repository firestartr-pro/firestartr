import { SCHEMA } from '../../claims/base/schema';
import {
  REGISTRY_HOST_DESCRIPTION,
  REGISTRY_HOST_PATTERN,
} from '../registry-host';

export default {
  $schema: SCHEMA,
  title: 'Build images results',
  description:
    'Build summary produced by the image build workflows and consumed to dispatch images to state repositories. The registry, repository and image_tag fields compose the published image reference, so they are constrained to the character sets the build workflows can emit. Other fields (flavor, version, image_type, image_repo, build_args, platforms...) are build metadata that legitimately varies, and are therefore left unconstrained.',
  type: 'array',
  items: {
    type: 'object',
    properties: {
      registry: {
        description: REGISTRY_HOST_DESCRIPTION,
        type: 'string',
        minLength: 1,
        maxLength: 255,
        pattern: REGISTRY_HOST_PATTERN,
      },
      repository: {
        description:
          "Repository path within the registry, including the configured services base path (for example 'service/my-org/my-repo').",
        type: 'string',
        minLength: 1,
        maxLength: 512,
        pattern: '^[A-Za-z0-9._/-]+$',
      },
      image_tag: {
        description:
          'Image tag, as normalized by the build workflow. Constrained to the OCI distribution reference grammar: first character must be alphanumeric or underscore, remaining up to 127 characters of alphanumeric, underscore, period, or hyphen. Total length <= 128. A registry that accepts a non-conforming tag has already violated the spec; rejecting here converts a non-portable reference into a clear error.',
        type: 'string',
        minLength: 1,
        maxLength: 128,
        pattern: '^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$',
      },
    },
    required: ['registry', 'repository', 'image_tag'],
    additionalProperties: true,
  },
};
