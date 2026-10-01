import * as fs from "fs"
import * as path from "path"
import common from "catalog_common"

import { ClaimValidation } from "../src/claims"

import {createTestContext} from "./auxiliar";

describe('validateClaims', () => {

  let context = null

  beforeAll(async () => {
  
      context = await createTestContext({})
  
  })

  afterAll(async () => {
  
     await context.destroy()
  
  })

  it('Is able to validate a group claim', async () => {

    const claim: string = await context.getFile("group_a")

    ClaimValidation.validateClaim(common.io.fromYaml(claim))

    ClaimValidation.validateClaim(common.io.fromYaml(claim), "firestartr.dev://common/GroupClaim")

  });


  it('Is able to validate a membership claim', async () => {

    const claim: string = await context.getFile("user_a")

    ClaimValidation.validateClaim(common.io.fromYaml(claim))

    ClaimValidation.validateClaim(common.io.fromYaml(claim), "firestartr.dev://common/UserClaim")

  });


  it('Is able to validate a component claim', async () => {

    const claim: string = await context.getFile("component_a")

    ClaimValidation.validateClaim(common.io.fromYaml(claim))

    ClaimValidation.validateClaim(common.io.fromYaml(claim), "firestartr.dev://common/ComponentClaim")

  });

  it('Is able to validate a component claim with features', async () => {

    const claim: string = await context.getFile("component_a")

    ClaimValidation.validateClaim(common.io.fromYaml(claim))

    ClaimValidation.validateClaim(common.io.fromYaml(claim), "firestartr.dev://common/ComponentClaim")

  });

  it('Is able to validate a component claim with repo flags', async () => {

    const claim: string = await context.getFile("component_a")

    const claimModified = common.io.fromYaml(claim)

    claimModified.providers.github.archiveOnDestroy = false

    ClaimValidation.validateClaim(claimModified)

    ClaimValidation.validateClaim(claimModified, "firestartr.dev://common/ComponentClaim")

  });

  it('Is able to validate a component claim with APIs fields', async () => {

    await context.applyPatches(
      'component_a',
      [
        {
          op: 'add',
          path: '/providesApis',
          value: [
            {
              name: 'api-component-a-openapi',
              definitionfile: 'api/openapi/openapi.yaml',
              type: 'openapi'
            },
            {
              name: 'api-component-a-asyncapi',
              definitionfile: '/api/asyncapi/asyncapi.yaml',
              type: 'asyncapi'
            }
          ]
        },
        {
          op: 'add',
          path: '/consumesApis',
          value: [
            'api-remote-a-openapi',
            'api-remote-b-asyncapi'
          ]
        }
      ]
    )

    const claim: string = await context.getFile('component_a')

    ClaimValidation.validateClaim(common.io.fromYaml(claim))

    ClaimValidation.validateClaim(common.io.fromYaml(claim), 'firestartr.dev://common/ComponentClaim')

    await context.restart()

  });

  it('Rejects undeclared properties in component claim', async () => {

    expect.assertions(1)

    const claim: string = await context.getFile("component_a")

    const claimModified = common.io.fromYaml(claim)

    claimModified.unknownProperty = "invalid"

    try {
      ClaimValidation.validateClaim(claimModified, "firestartr.dev://common/ComponentClaim")
    } catch (e: any) {
      expect(e).toBeInstanceOf(Array)
    }

  });

  it('Is able to validate a system claim', async () => {

    const claim: string = await context.getFile("system_a")

    ClaimValidation.validateClaim(common.io.fromYaml(claim))

    ClaimValidation.validateClaim(common.io.fromYaml(claim), "firestartr.dev://common/SystemClaim")

  });


  it('Is able to validate a domain claim', async () => {

    const claim: string = await context.getFile("domain_a")

    ClaimValidation.validateClaim(common.io.fromYaml(claim))

    ClaimValidation.validateClaim(common.io.fromYaml(claim), "firestartr.dev://common/DomainClaim")

  });

  it('Is able to validate a tfworkspace claim', async () => {

    const claim: string = await context.getFile("workspace_a")

    ClaimValidation.validateClaim(common.io.fromYaml(claim))

    ClaimValidation.validateClaim(common.io.fromYaml(claim), "firestartr.dev://common/TFWorkspaceClaim")

  });

  it('Is able to validate a argodeploy claim', async () => {

    const claim: string = await context.getFile("argodeploy_a")

    ClaimValidation.validateClaim(common.io.fromYaml(claim))

    ClaimValidation.validateClaim(common.io.fromYaml(claim), "firestartr.dev://common/ArgoDeployClaim")

  });


  it('Is able to validate a secrets claim', async () => {

    const claim: string = await context.getFile("secret_a")

    ClaimValidation.validateClaim(common.io.fromYaml(claim))

    ClaimValidation.validateClaim(common.io.fromYaml(claim), "firestartr.dev://common/SecretsClaim")

  });

  it('Is able to validate a wrong secrets claim', async () => {

    expect.assertions(3)

    await context.applyPatches(
    
        "secret_a",

        [
            {op: "remove", path: "/providers/external_secrets/secretStore"}
        ]
    
    )

    const claim: string = await context.getFile("secret_a")

    try {
      ClaimValidation.validateClaim(

        common.io.fromYaml(claim),

        "firestartr.dev://common/SecretsClaim"

      )
    } catch (e: any) {

      expect(e).toBeInstanceOf(Array)

      expect(e).toHaveLength(1)

      expect(e[0].message).toBe("must have required property 'secretStore'")
    }

    await context.restart()

  });

  it('Is able to validate a organization webhook claim', async () => {

    const claim: string = await context.getFile("orgwebhook_a")

    ClaimValidation.validateClaim(common.io.fromYaml(claim))

    ClaimValidation.validateClaim(common.io.fromYaml(claim), "firestartr.dev://common/OrgWebhookClaim")

  });

  it('Is able to validate an organization settings claim', async () => {

    const claim: string = await context.getFile("orgsettings_a")

    ClaimValidation.validateClaim(common.io.fromYaml(claim))

    ClaimValidation.validateClaim(common.io.fromYaml(claim), "firestartr.dev://common/OrgSettingsClaim")

  });

  it('Rejects an organization settings claim with invalid GitHub org', async () => {

    expect.assertions(3)

    await context.applyPatches(
      'orgsettings_a',
      [
        {
          op: 'replace',
          path: '/providers/github/org',
          value: 'Firestartr-Test'
        }
      ]
    )

    const claim: string = await context.getFile('orgsettings_a')

    try {
      ClaimValidation.validateClaim(common.io.fromYaml(claim), 'firestartr.dev://common/OrgSettingsClaim')
    } catch (e: any) {
      expect(e).toBeInstanceOf(Array)
      expect(e).toHaveLength(1)
      expect(e[0].message).toBe('must match pattern "^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$"')
    }

    await context.restart()

  });

  it('Rejects an organization settings claim with invalid default repository permission', async () => {

    expect.assertions(3)

    await context.applyPatches(
      'orgsettings_a',
      [
        {
          op: 'replace',
          path: '/providers/github/default_repository_permission',
          value: 'invalid'
        }
      ]
    )

    const claim: string = await context.getFile('orgsettings_a')

    try {
      ClaimValidation.validateClaim(common.io.fromYaml(claim), 'firestartr.dev://common/OrgSettingsClaim')
    } catch (e: any) {
      expect(e).toBeInstanceOf(Array)
      expect(e).toHaveLength(1)
      expect(e[0].message).toBe('must be equal to one of the allowed values')
    }

    await context.restart()

  });

  it('Is able to validate an organization settings claim with tfStateKey', async () => {

    await context.applyPatches(
      'orgsettings_a',
      [
        {
          op: 'add',
          path: '/providers/github/tfStateKey',
          value: '123e4567-e89b-42d3-a456-426614174000'
        }
      ]
    )

    const claim: string = await context.getFile('orgsettings_a')

    ClaimValidation.validateClaim(common.io.fromYaml(claim))

    ClaimValidation.validateClaim(common.io.fromYaml(claim), 'firestartr.dev://common/OrgSettingsClaim')

    await context.restart()

  });

  it('Rejects an organization settings claim missing github provider name', async () => {

    expect.assertions(3)

    await context.applyPatches(
      "orgsettings_a",
      [
        {op: "remove", path: "/providers/github/name"}
      ]
    )

    const claim: string = await context.getFile("orgsettings_a")

    try {
      ClaimValidation.validateClaim(common.io.fromYaml(claim), "firestartr.dev://common/OrgSettingsClaim")
    } catch (e: any) {
      expect(e).toBeInstanceOf(Array)
      expect(e).toHaveLength(1)
      expect(e[0].message).toBe("must have required property 'name'")
    }

    await context.restart()

  });

  it('Rejects an organization settings claim missing github org', async () => {

    expect.assertions(3)

    await context.applyPatches(
      "orgsettings_a",
      [
        {op: "remove", path: "/providers/github/org"}
      ]
    )

    const claim: string = await context.getFile("orgsettings_a")

    try {
      ClaimValidation.validateClaim(common.io.fromYaml(claim), "firestartr.dev://common/OrgSettingsClaim")
    } catch (e: any) {
      expect(e).toBeInstanceOf(Array)
      expect(e).toHaveLength(1)
      expect(e[0].message).toBe("must have required property 'org'")
    }

    await context.restart()

  });

  it('Rejects an organization settings claim missing github billing email', async () => {

    expect.assertions(3)

    await context.applyPatches(
      "orgsettings_a",
      [
        {op: "remove", path: "/providers/github/billing_email"}
      ]
    )

    const claim: string = await context.getFile("orgsettings_a")

    try {
      ClaimValidation.validateClaim(common.io.fromYaml(claim), "firestartr.dev://common/OrgSettingsClaim")
    } catch (e: any) {
      expect(e).toBeInstanceOf(Array)
      expect(e).toHaveLength(1)
      expect(e[0].message).toBe("must have required property 'billing_email'")
    }

    await context.restart()

  });

  it('Is able to validate a membership claim with no provider', async () => {

    await context.applyPatches(
    
        "user_a",

        [
            {op: "remove", path: "/providers/github"}
        ]
    
    )

    const claim: string = await context.getFile("user_a")

    ClaimValidation.validateClaim(common.io.fromYaml(claim))

    ClaimValidation.validateClaim(common.io.fromYaml(claim), "firestartr.dev://common/UserClaim")

    await context.restart()

  });


  it('Is able to validate a component with repo vars', async () => {

    await context.applyPatches(
    
        "component_a",

        [
            {
                op: "add", path: "/providers/github/vars", value: {
                
                    actions: [
            
                        {
                            name: "FOO",

                            value: "FOO_VALUE"
                        }
            
                    ]

                }
            }
        ]
    
    )

    const claim: string = await context.getFile("component_a")

    ClaimValidation.validateClaim(common.io.fromYaml(claim))

    ClaimValidation.validateClaim(common.io.fromYaml(claim), "firestartr.dev://common/ComponentClaim")

    await context.restart()

  });

  it('Is able to validate a component with repo secrets', async () => {

    await context.applyPatches(
    
        "component_a",

        [
            {
                op: "add", path: "/providers/github/secrets", value: {
                
                    actions: [
            
                        {
                            name: "FOO",

                            value: "ref:secretsclaim:foo:my-secret"
                        },

                        {
                            name: "FOO2",

                            value: "ref:secretsclaim:foo:my-secret2"
                        }
            
                    ]

                }
            }
        ]
    
    )

    const claim: string = await context.getFile("component_a")

    ClaimValidation.validateClaim(common.io.fromYaml(claim))

    ClaimValidation.validateClaim(common.io.fromYaml(claim), "firestartr.dev://common/ComponentClaim")

    await context.restart()

  });

  it('Is able to validate a scheduled workspace', async () => {

    await context.applyPatches(
    
        "workspace_a",

        [
            {
                op: "add", path: "/providers/terraform/sync", value: {

                    schedule: '*/5 * * * *',
                    enabled: true
                
                }
            }
        ]
    
    )

    const claim: string = await context.getFile("workspace_a")

    ClaimValidation.validateClaim(common.io.fromYaml(claim))

    ClaimValidation.validateClaim(common.io.fromYaml(claim), "firestartr.dev://common/TFWorkspaceClaim")

    await context.restart()

  });

  it('Is able to validate a period workspace', async () => {

    await context.applyPatches(
    
        "workspace_a",

        [
            {
                op: "add", path: "/providers/terraform/sync", value: {

                    period: '5h',
                    enabled: true
                
                }
            }
        ]
    
    )

    const claim: string = await context.getFile("workspace_a")

    ClaimValidation.validateClaim(common.io.fromYaml(claim))

    ClaimValidation.validateClaim(common.io.fromYaml(claim), "firestartr.dev://common/TFWorkspaceClaim")

    await context.restart()

  });

  it('Is able to validate an incorrect SecretsClaim key', async () => {

    await context.applyPatches(
    
        "secret_a",

        [
            {
                op: "replace", 
                path: "/providers/external_secrets/externalSecrets/secrets", 
                value: [
                
                    {
                        secretName: "%invalid%&key",

                        remoteRef: "rds_conn"
                    }
                
                ]

            }
        ]
    
    )

    const claim: string = await context.getFile("secret_a")

    ClaimValidation.validateClaim(common.io.fromYaml(claim))

    try {
      ClaimValidation.validateClaim(

        common.io.fromYaml(claim),

        "firestartr.dev://common/SecretsClaim"

      )
    } catch (e: any) {

      // message: 'must match pattern "^([a-zA-Z0-9._-]+)$"'

      expect(e).toBeInstanceOf(Array)

      expect(e).toHaveLength(1)

    }

    await context.restart()

  });
});
