export default {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://raw.githubusercontent.com/firestartr-pro/docs/refs/heads/main/site/raw/core/dot-firestartr/main/helm_repositories.schema.json',
  title: 'Firestartr Helm repository',
  description: 'A named HTTP, HTTPS or OCI Helm chart repository.',
  type: 'object',
  properties: {
    name: {
      title: 'Repository name',
      description: 'Non-empty name used to identify the Helm repository.',
      type: 'string',
      minLength: 1,
    },
    url: {
      title: 'Repository URL',
      description:
        'Repository location beginning with http://, https:// or oci://.',
      type: 'string',
      pattern: '^(https?|oci)://',
    },
  },
  required: ['name', 'url'],
  additionalProperties: false,
};
