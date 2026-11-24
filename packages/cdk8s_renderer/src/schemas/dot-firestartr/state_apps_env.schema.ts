import { SCHEMA } from '../../claims/base/schema';

export default {
  $schema: SCHEMA,
  title: 'State repo app environment',
  description:
    'Helm release configuration for an application environment in an app-<app> state repository (kubernetes/<cluster>/<tenant>/<env>.yaml).',
  type: 'object',
  properties: {
    chart: {
      title: 'Helm chart',
      description:
        'Helm chart reference in the form <registry-name>/<path>/<chart>.',
      type: 'string',
    },
    version: {
      title: 'Chart version',
      description: 'Version of the Helm chart to deploy.',
      type: 'string',
    },
    releaseName: {
      title: 'Release name',
      description: 'Helm release name; defaults to the application name.',
      type: 'string',
    },
    namespace: {
      title: 'Kubernetes namespace',
      description:
        'Target Kubernetes namespace; defaults to <tenant>-<app>-<env>.',
      type: 'string',
    },
    hooks: {
      title: 'Helmfile hooks',
      description: 'Helmfile lifecycle hooks attached to the release.',
      type: 'array',
      items: {
        title: 'Helmfile hook',
        description: 'A helmfile hook definition.',
        type: 'object',
      },
    },
    patches: {
      title: 'Named patches',
      description:
        'Names of reusable patches defined in lib/kustomizations/json_patches.yaml.',
      type: 'array',
      items: {
        title: 'Patch name',
        description: 'Name of a patch in lib/kustomizations/json_patches.yaml.',
        type: 'string',
      },
    },
    extraPatches: {
      title: 'Extra patches',
      description: 'Inline helmfile jsonPatches applied to the release.',
      type: 'array',
      items: {
        title: 'JSON patch',
        description: 'An inline helmfile jsonPatch definition.',
        type: 'object',
      },
    },
    remoteArtifacts: {
      title: 'Remote artifacts',
      description:
        'External files downloaded by the hydrator before rendering.',
      type: 'array',
      items: {
        title: 'Remote artifact',
        description: 'A remote file to download into the release workspace.',
        type: 'object',
        properties: {
          filename: {
            title: 'Artifact filename',
            description: 'Local filename for the downloaded artifact.',
            type: 'string',
          },
          url: {
            title: 'Artifact URL',
            description: 'URL from which the hydrator downloads the artifact.',
            type: 'string',
          },
        },
        required: ['filename', 'url'],
        additionalProperties: false,
      },
    },
    execs: {
      title: 'Value exec commands',
      description:
        'Commands whose output is merged into the release values during hydration.',
      type: 'array',
      items: {
        title: 'Exec command',
        description: 'A command executed to produce release values.',
        type: 'object',
        properties: {
          command: {
            title: 'Command',
            description: 'Executable to run.',
            type: 'string',
          },
          args: {
            title: 'Command arguments',
            description: 'Arguments passed to the command.',
            type: 'array',
            items: {
              title: 'Argument',
              description: 'A single command-line argument.',
              type: 'string',
            },
          },
        },
        required: ['command'],
        additionalProperties: false,
      },
    },
    set: {
      title: 'Helm set overrides',
      description: 'Key-value overrides passed to the Helm release.',
      type: 'array',
      items: {
        title: 'Set override',
        description: 'A single Helm --set name/value pair.',
        type: 'object',
        properties: {
          name: {
            title: 'Value name',
            description: 'Helm value path to override.',
            type: 'string',
          },
          value: {
            title: 'Value',
            description:
              'Override value assigned to the Helm value path. A string: the hydrator renders it with tpl.',
            type: 'string',
          },
        },
        required: ['name', 'value'],
        additionalProperties: false,
      },
    },
  },
  required: ['chart', 'version'],
  additionalProperties: false,
};
