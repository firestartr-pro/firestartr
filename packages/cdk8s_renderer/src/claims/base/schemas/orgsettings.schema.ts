import { SCHEMA } from '../schema';

export default {
  $schema: SCHEMA,
  $id: 'OrgSettingsClaim',
  definitions: {
    OrgSettingsClaim: {
      $id: 'firestartr.dev://common/OrgSettingsClaim',
      type: 'object',
      description: 'A GitHub organization settings claim',
      unevaluatedProperties: false,
      allOf: [
        { $ref: 'firestartr.dev://common/ClaimEnvelope' },
        {
          type: 'object',
          properties: {
            providers: {
              type: 'object',
              properties: {
                github: {
                  $ref: 'firestartr.dev://github/GithubOrgSettingsClaim',
                },
              },
              additionalProperties: false,
            },
          },
        },
      ],
    },
  },
};
