import { Testing, YamlOutputType } from "cdk8s";
import { AllowedProviders, configureProvider, setExcludedPaths, setPath } from "../src/config";
import { emptyRenderedClaims } from "../src/refresolver";
import * as fs from "fs";
import * as path from "path";
import { render } from "../src/renderer/renderer";

import { resetLazyLoader } from "../src/loader/lazy_loader";

import { createTestContext } from "./auxiliar";

import {
  claimsRefListAsGenerator,
  resolveClaimEntries,
} from '../src/utils/claimUtils';

describe('CDK8s Renderer', () => {

  jest.setTimeout(30000);

  /**
   * Prepare the folders and the app to render
   */
  const { outDirPath, catalogApp, app }: any = prepareTest(
    "fixtures/tfworkspace/default_test"
  );

  let context = null

  beforeAll(async () => {

    context = await createTestContext({})

  })


  /**
   * Clean the rendered claims and the outdir
   */
  beforeEach(async () => {

    emptyRenderedClaims()

    fs.rmSync(outDirPath, { recursive: true, force: true });

  });

  beforeEach(async () => {

    resetLazyLoader()

    await context.restart()

  })

  it('Is able to render a TFWorkspaceClaim', async () => {

    const { outDirPath, catalogApp, app }: any = prepareTest(
      await context.getClaimsDir(), false
    );

    setPath("crs", context.getBaseCrsDir());

    /**
     * Expected TFWorkspaceCR from TFWorkspaceClaim rendering
     */
    const expectedTFWorkspaceCR = {
      apiVersion: 'firestartr.dev/v1',
      kind: 'FirestartrTerraformWorkspace',
      metadata: {
        annotations: {
          'backstage.io/kubernetes-id': 'workspace_b',
          'firestartr.dev/claim-ref': 'TFWorkspaceClaim/workspace_b',
          'firestartr.dev/external-name': 'test_a',
          'firestartr.dev/policy': 'observe',
          'firestartr.dev/revision': '2'
        },
        labels: { 'claim-ref': 'workspace-b' },
        name: 'test-a-7b3b3394-cf05-477a-841e-722b9df9cdeb'
      },
      spec: {
        context: {
          backend: { ref: { kind: 'FirestartrProviderConfig', name: 'foo' } },
          providers: [
            {
              ref: { kind: 'FirestartrProviderConfig', name: 'aws-westeurope' }
            }
          ]
        },
        firestartr: { tfStateKey: '7b3b3394-cf05-477a-841e-722b9df9cdeb' },
        values: "{\"a\":\"${{ references.external_secret_secret-a.rds_conn }}\"}",
        module: "https://github.com/infra/acme-predev-aks@main",
        source: 'Remote',
        references: [
          {
            name: 'external_secret_secret_a.rds_conn',
            ref: {
              kind: 'ExternalSecret',
              name: 'secret-a',
              key: 'rds_conn'
            }
          }
        ]
      }
    }

    /**
     * Expected Catalog Resource from TFWorkspaceClaim
     */
    const expectedCatalogResource = {
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'Resource',
      metadata: {
        annotations: {
          title: 'workspace_b'
        },
        name: 'workspace-b',
        title: 'workspace_b',
      },
      spec: {
        dependsOn: [],
        owner: 'group:firestartr-test-all',
        system: 'system:system_a',
        type: 'test-a-resource-type',
        values: {
          context: {
            backend: {
              name: "foo",
            },
            providers: [
              {
                name: "aws-westeurope",
              },
            ],
          },
          module: "https://github.com/infra/acme-predev-aks@main",
          name: "test_a",
          source: "Remote",
          policy: "observe",
          sync: {
            enabled: false,
            policy: "apply"
          },
          values: {
            "a": "${{ secret:secret_a.rds_conn }}",
          },
          valuesSchema: "file:/global/my-schemas/my-schema.json"
        },
      }
    }

    await render(
      catalogApp,

      app,

      resolveClaimEntries([
        await context.getFilePath("workspace_a"),
        await context.getFilePath("workspace_b"),
      ])
    )

    app.synth()

    catalogApp.synth()

    expect(app.node.children.length).toBe(6)

    /**
     * Check if the rendered claim generated a resource in the catalog app
     */
    const catalogResource = catalogApp.node.findChild("tfworkspaceclaim-workspace_b")


    expect(catalogResource).toBeDefined()

    const catalogApiObject = catalogResource.toJson()[0]


    /**
     * Expect the rendered claim to equal the expect object
     */
    expect(catalogApiObject).toEqual(expectedCatalogResource)

    /**
     * Check if the rendered claim generated a resource in the app
     */
    const tfWorkspaceCR = app.node.findChild("terraform-tfworkspaceclaim-workspace_b")

    expect(tfWorkspaceCR).toBeDefined()

    const tfWorkspaceCRObject = tfWorkspaceCR.toJson()[0]

    expect(tfWorkspaceCRObject).toEqual(expectedTFWorkspaceCR)
  })


  it('Detects cycling dependencies', async () => {

    await context.applyPatches(

      "workspace_b",

      [
        {
          op: "add",
          path: "/providers/terraform/values/circular",
          value: '${{ tfworkspace:workspace_a:outputs.id }}'
        }
      ]

    )

    const { catalogApp, app }: any = prepareTest(

      await context.getClaimsDir(),

      false
    );

    try {

      await render(

        catalogApp,

        app,

        resolveClaimEntries([
          await context.getClaimsDir()
        ])

      )

      throw new Error("TEST FAILED")

    } catch (e: any) {
      expect(e.message).toContain(
        'Circular dependency detected for \'TFWorkspaceClaim-workspace_a'
      )

    }

  })

  it('Works with multiple dependencies to the same module', async () => {

    await context.duplicateFile(

      "workspace_a",

      "workspace_xx",
    )

    await context.applyPatches(

      `workspace_xx`,

      [
        { op: "replace", path: "/name", value: `workspace_xx` },

        { op: "replace", path: "/providers/terraform/name", value: `workspace_xx` },

      ]

    )

    for (let letter of ["aa", "bb", "cc"]) {

      await context.duplicateFile(

        "workspace_a",

        `workspace_${letter}`
      )

      await context.applyPatches(

        `workspace_${letter}`,

        [
          { op: "replace", path: "/name", value: `workspace_${letter}` },

          { op: "replace", path: "/providers/terraform/name", value: `workspace_${letter}` },

          {

            op: "add",

            path: "/providers/terraform/values/resource_group",

            value: '${{ tfworkspace:workspace_xx:outputs.name}}'
          },

        ]


      )

    }

    const { catalogApp, app }: any = prepareTest(
      await context.getClaimsDir(), false
    );

    await render(

      catalogApp,

      app,

      resolveClaimEntries([
        await context.getClaimsDir()
      ])

    )

    app.synth()

    catalogApp.synth()

    const moduleA = app.node.findChild("terraform-tfworkspaceclaim-workspace_aa")

    expect(moduleA).toBeDefined()

    const moduleB = app.node.findChild("terraform-tfworkspaceclaim-workspace_bb")

    expect(moduleB).toBeDefined()

    const moduleC = app.node.findChild("terraform-tfworkspaceclaim-workspace_cc")

    expect(moduleC).toBeDefined()

    const moduleX = app.node.findChild("terraform-tfworkspaceclaim-workspace_xx")

    expect(moduleX).toBeDefined()

  })

  it("Throws an error when a file surpasses Kubernetes' file size limit (1.5MB)", async () => {
    const oversizedModuleValue = 'output test { value = "a" }\n'.repeat(50000);

    await context.applyPatches("workspace_a", [{
      op: "add",
      path: "/providers/terraform/module",
      value: oversizedModuleValue,
    }])

    const { catalogApp, app }: any = prepareTest(
      await context.getClaimsDir(), false
    );

    let e = ""

    try{
    
        await render(catalogApp, app, resolveClaimEntries(
            [await context.getClaimsDir()]
        ))
    }
    catch(err){
        e = err.message
    }

    expect(e).toContain('exceeds the Kubernetes object size limit by')
  })

  it("controls a SecretsClaim reference to an inexistent key", async () => {

    await context.applyPatches("workspace_a", [{
      op: "replace",
      path: "/providers/terraform/values",
      value: {
        test: "ref:secretsclaim:secret_a:no-key"
      }
    }])

    const { catalogApp, app }: any = prepareTest(
      await context.getClaimsDir(), false
    );

    let e = ""

    try{
        await render(catalogApp, app, resolveClaimEntries(
            [await context.getClaimsDir()]
        ))
    
    }
    catch(err){
        e = err.message
    }

    expect(e).toEqual("CrossReference error: TFWorkspaceClaim/workspace_a references a non-existent secret key: 'secret_a:no-key'")
  })


})




function prepareTest(claimPath: string, setProvider: boolean = true) {

  if (setProvider) {

    configureProvider(AllowedProviders.all);

  }

  const outDirPath: string = path.join("/", "tmp", ".resources");

  const catalogApp = Testing.app({

    outdir: "/tmp/.catalog",

    outputFileExtension: ".yaml",

    yamlOutputType: YamlOutputType.FILE_PER_RESOURCE,

  });

  const app = Testing.app({

    outdir: outDirPath,

    outputFileExtension: ".yaml",

    yamlOutputType: YamlOutputType.FILE_PER_RESOURCE,

  });

  setPath("initializers", path.join(__dirname, "fixtures/initializers"));

  setPath("crs", path.join(__dirname, "fixtures/previous_cr_tf_workspace"));

  setPath("globals", path.join(__dirname, "fixtures/globals"));

  setPath("claims", path.isAbsolute(claimPath) ? claimPath : path.join(__dirname, claimPath));

  setPath("claimsDefaults", path.join(__dirname, "fixtures/initializers"));

  setExcludedPaths([path.join(__dirname, "fixtures/nocrs")]);

  return {

    outDirPath,

    catalogApp,

    app,

  };
}
