import validate from "../src/validate"

import render, { getClaimPatches, isFeatureArgsValidationEnabled } from "../src/render"

import * as path from "path"

import auxiliar, { createRenderContext } from "../src/auxiliar"

async function buildFeatureWithSchema(flag: string[], withSchema: boolean) {
  const feature = await createRenderContext('feature-args-gate-')

  await feature.setFile('config.yaml', [
    'feature_name: "feature_gate"',
    ...flag,
    'args:',
    '  FOO:',
    '    $arg: foo',
    'files:',
    '  - src: test.txt',
    '    dest: test.txt',
    'claimPatches:',
    '  - name: "add_annotation"',
    '    op: "add"',
    '    path: "/annotations/backstage.io~1techdocs-ref"',
    '    value: "url:https://github.com/prefapp/feature_gate/tree/main"',
  ].join('\n'))

  await feature.setFile('templates/test.txt', 'hello {{| FOO |}}')

  if (withSchema) {
    await feature.setFile('schema.json', JSON.stringify({
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      properties: {
        feature_name: { const: 'feature_gate' },
        foo: { type: 'string' },
      },
    }))
  }

  return feature
}

describe("The renderer", function(){

  it("Can validate a feature", function(){

    validate(path.join(__dirname, "fixtures/features/feature_a"))

  })

  it("Can validate a feature with filesTemplates", function(){

    validate(path.join(__dirname, "fixtures/features/feature_files_templates"))

  })

  it("Can control a faulty feature", function(){

    try{
      validate(path.join(__dirname, "fixtures/features/faulty_feature"))
      throw "NOT_WORKING"
    }
    catch(err){
      expect(err).not.toEqual("NOT_WORKING")
    }

  })

  it("Accepts legacy provider-keyed patches", async function(){

    const feature = await createRenderContext('legacy-provider-keyed-patches-')

    try {
      await feature.setFile('config.yaml', [
        'feature_name: "legacy_patches"',
        'args: {}',
        'files: []',
        'patches:',
        '  catalog:',
        '    - name: "add_annotation"',
        '      op: "add"',
        '      path: "/metadata/annotations/backstage.io~1techdocs-ref"',
        '      value: "url:https://github.com/{{| ORG |}}/{{| REPO_NAME |}}/tree/main"',
      ].join('\n'))

      expect(() => validate(feature.getContextPath())).not.toThrow()
    } finally {
      await feature.remove()
    }

  })

  it("Accepts claimPatches without a name (name is optional)", async function(){

    const feature = await createRenderContext('claim-patches-no-name-')

    try {
      await feature.setFile('config.yaml', [
        'feature_name: "no_name_patches"',
        'args: {}',
        'files: []',
        'claimPatches:',
        '  - op: "add"',
        '    path: "/annotations/backstage.io~1techdocs-ref"',
        '    value: "url:https://example.com"',
      ].join('\n'))

      expect(() => validate(feature.getContextPath())).not.toThrow()
    } finally {
      await feature.remove()
    }

  })

})

describe("Feature args validation", function(){

  const featurePath = path.join(__dirname, "fixtures/features/feature_a")

  const entity = {
    name: "test",
    annotations: {
      "firestartr.dev/dest-annotation": "test.txt",
    },
    providers: {
      github: {
        org: "prefapp",
        technology: { stack: "python" },
      },
    },
  }

  async function renderFeatureA(args: any) {
    const ctx = await createRenderContext('feature-args-')
    try {
      return render(featurePath, ctx.getContextPath(), entity, {}, args)
    } finally {
      await ctx.remove()
    }
  }

  it("Renders a feature with valid args", async function(){

    await expect(renderFeatureA({ foo: "hello" })).resolves.toBeDefined()

  })

  it("Rejects an unknown arg, naming it", async function(){

    await expect(renderFeatureA({ nope: "x" })).rejects.toThrow(/nope/)

  })

  it("Rejects a non-string value for a typed arg", async function(){

    await expect(renderFeatureA({ foo: 123 })).rejects.toThrow(/foo/)

  })

  async function renderTempFeature(feature: any, args: any) {
    const renderDir = await createRenderContext('feature-args-gate-out-')

    try {
      return render(feature.getContextPath(), renderDir.getContextPath(), {}, {}, args)
    } finally {
      await renderDir.remove()
    }
  }

  it("Warns and renders when the feature has no schema.json", async function(){

    const feature = await buildFeatureWithSchema(['enable_validation: true'], false)

    try {
      await expect(renderTempFeature(feature, { nope: 'x' })).resolves.toBeDefined()
    } finally {
      await feature.remove()
    }

  })

  it("Skips validation when the feature does not set enable_validation", async function(){

    const feature = await buildFeatureWithSchema([], true)

    try {
      await expect(renderTempFeature(feature, { nope: 'x' })).resolves.toBeDefined()
    } finally {
      await feature.remove()
    }

  })

  it("Skips validation when enable_validation is false", async function(){

    const feature = await buildFeatureWithSchema(['enable_validation: false'], true)

    try {
      await expect(renderTempFeature(feature, { foo: 123 })).resolves.toBeDefined()
    } finally {
      await feature.remove()
    }

  })

  it("Rejects a non-boolean enable_validation", async function(){

    const feature = await buildFeatureWithSchema(['enable_validation: "true"'], true)

    try {
      expect(() => validate(feature.getContextPath())).toThrow()

      await expect(renderTempFeature(feature, { foo: 'hello' })).rejects.toThrow()
    } finally {
      await feature.remove()
    }

  })

  it("Ignores the downloader-injected traceability key", async function(){

    await expect(
      renderFeatureA({ foo: "hello", traceability: { owner: "prefapp", name: "feature_a" } }),
    ).resolves.toBeDefined()

  })

  it("Aggregates every offending arg in one error message", async function(){

    const error = await renderFeatureA({ foo: 123, nope: "x" }).catch((e: any) => e)

    expect(error.message).toMatch(/foo/)

    expect(error.message).toMatch(/nope/)

  })

})

describe("isFeatureArgsValidationEnabled", function(){

  it("Only a boolean true enables feature args validation", function(){

    expect(isFeatureArgsValidationEnabled({})).toBe(false)

    expect(isFeatureArgsValidationEnabled({ enable_validation: false })).toBe(false)

    expect(isFeatureArgsValidationEnabled({ enable_validation: 'true' })).toBe(false)

    expect(isFeatureArgsValidationEnabled({ enable_validation: true })).toBe(true)

  })

})

describe("Feature args validation on the claim-stitching path", function(){

  const expectedPatches = [
    {
      name: 'add_annotation',
      op: 'add',
      path: '/annotations/backstage.io~1techdocs-ref',
      value: 'url:https://github.com/prefapp/feature_gate/tree/main',
    },
  ]

  function getPatchesFromTempFeature(feature: any, args: any) {
    return getClaimPatches(feature.getContextPath(), {}, {}, args)
  }

  it("Returns the claimPatches when validation is enabled and args are valid", async function(){

    const feature = await buildFeatureWithSchema(['enable_validation: true'], true)

    try {
      expect(getPatchesFromTempFeature(feature, { foo: 'hello' })).toEqual(expectedPatches)
    } finally {
      await feature.remove()
    }

  })

  it("Rejects a non-string value for a typed arg when validation is enabled", async function(){

    const feature = await buildFeatureWithSchema(['enable_validation: true'], true)

    try {
      expect(() => getPatchesFromTempFeature(feature, { foo: 123 })).toThrow(/foo/)
    } finally {
      await feature.remove()
    }

  })

  it("Rejects an unknown arg when validation is enabled", async function(){

    const feature = await buildFeatureWithSchema(['enable_validation: true'], true)

    try {
      expect(() => getPatchesFromTempFeature(feature, { nope: 'x' })).toThrow(/nope/)
    } finally {
      await feature.remove()
    }

  })

  it("Skips validation when enable_validation is false", async function(){

    const feature = await buildFeatureWithSchema(['enable_validation: false'], true)

    try {
      expect(
        getPatchesFromTempFeature(feature, { foo: 123, nope: 'x' }),
      ).toEqual(expectedPatches)
    } finally {
      await feature.remove()
    }

  })

  it("Skips validation when the feature does not set enable_validation", async function(){

    const feature = await buildFeatureWithSchema([], true)

    try {
      expect(getPatchesFromTempFeature(feature, { nope: 'x' })).toEqual(expectedPatches)
    } finally {
      await feature.remove()
    }

  })

  it("Warns and returns the claimPatches when the feature has no schema.json", async function(){

    const feature = await buildFeatureWithSchema(['enable_validation: true'], false)

    try {
      expect(getPatchesFromTempFeature(feature, { nope: 'x' })).toEqual(expectedPatches)
    } finally {
      await feature.remove()
    }

  })

})

describe("Path traversal validation", function(){

  async function buildConfigFeature(files: string, filesTemplates: string) {
    const feature = await createRenderContext('feature-path-validation-')
    await feature.setFile('config.yaml', [
      'feature_name: "traversal"',
      'args: {}',
      ...files.split('\n'),
      ...filesTemplates.split('\n'),
      'claimPatches: []',
    ].join('\n'))
    return feature
  }

  it("Rejects a feature whose file src escapes the feature directory", async function(){

    const feature = await buildConfigFeature(
      'files:\n  - src: ../secret.txt\n    dest: leaked.txt',
      ''
    )

    expect(() => validate(feature.getContextPath())).toThrow()

    await feature.remove()

  })

  it("Rejects a feature whose filesTemplates entry escapes the feature directory", async function(){

    const feature = await buildConfigFeature(
      'files: []',
      'filesTemplates:\n  - ../evil.tpl'
    )

    expect(() => validate(feature.getContextPath())).toThrow()

    await feature.remove()

  })

  it("Rejects a feature whose file dest escapes the render target", async function(){

    const feature = await buildConfigFeature(
      'files:\n  - src: ok.txt\n    dest: ../leaked.txt',
      ''
    )

    expect(() => validate(feature.getContextPath())).toThrow()

    await feature.remove()

  })

})

describe("Path traversal validation with allow_non_anchored_paths", function(){

  async function buildConfigFeature(files: string, filesTemplates: string, allowNonAnchoredPaths: boolean) {
    const feature = await createRenderContext('feature-path-validation-')
    const meta = allowNonAnchoredPaths
      ? ['meta:', '  allow_non_anchored_paths: true']
      : []
    await feature.setFile('config.yaml', [
      'feature_name: "traversal"',
      'args: {}',
      ...meta,
      ...files.split('\n'),
      ...filesTemplates.split('\n'),
      'claimPatches: []',
    ].join('\n'))
    return feature
  }

  it("Accepts a feature whose file src escapes the feature directory", async function(){

    const feature = await buildConfigFeature(
      'files:\n  - src: ../secret.txt\n    dest: leaked.txt',
      '',
      true
    )

    expect(() => validate(feature.getContextPath())).not.toThrow()

    await feature.remove()

  })

  it("Accepts a feature whose filesTemplates entry escapes the feature directory", async function(){

    const feature = await buildConfigFeature(
      'files: []',
      'filesTemplates:\n  - ../evil.tpl',
      true
    )

    expect(() => validate(feature.getContextPath())).not.toThrow()

    await feature.remove()

  })

  it("Accepts a feature whose file dest escapes the render target", async function(){

    const feature = await buildConfigFeature(
      'files:\n  - src: ok.txt\n    dest: ../leaked.txt',
      '',
      true
    )

    expect(() => validate(feature.getContextPath())).not.toThrow()

    await feature.remove()

  })

})

describe("The render_tests.yaml schema", function(){

  const { loadAndValidateRenderTests } = auxiliar

  async function featureWithTests(tests: string) {
    const feature = await createRenderContext('render-tests-')
    await feature.setFile('render_tests.yaml', tests)
    return feature
  }

  it("Accepts a test that declares only cr, the shape every real feature uses", async function(){

    const feature = await featureWithTests([
      'tests:',
      '  - name: test1',
      '    cr: "../../generic-fixtures/cr.yaml"',
    ].join('\n'))

    try {
      expect(loadAndValidateRenderTests(feature.getContextPath())).toEqual({
        tests: [{ name: 'test1', cr: '../../generic-fixtures/cr.yaml' }],
      })
    } finally {
      await feature.remove()
    }

  })

  it("Accepts a test that declares only claim", async function(){

    const feature = await featureWithTests([
      'tests:',
      '  - name: test1',
      '    claim: "../../generic-fixtures/claim.yaml"',
    ].join('\n'))

    try {
      expect(
        loadAndValidateRenderTests(feature.getContextPath()).tests[0].claim,
      ).toEqual('../../generic-fixtures/claim.yaml')
    } finally {
      await feature.remove()
    }

  })

  it("Accepts a test that declares both cr and claim", async function(){

    const feature = await featureWithTests([
      'tests:',
      '  - name: test1',
      '    cr: "../../generic-fixtures/cr.yaml"',
      '    claim: "../../generic-fixtures/claim.yaml"',
    ].join('\n'))

    try {
      expect(() =>
        loadAndValidateRenderTests(feature.getContextPath()),
      ).not.toThrow()
    } finally {
      await feature.remove()
    }

  })

  it("Accepts args alongside the claim path", async function(){

    const feature = await featureWithTests([
      'tests:',
      '  - name: test1',
      '    cr: "../../generic-fixtures/cr.yaml"',
      '    args:',
      '      use_private_modules: "always()"',
    ].join('\n'))

    try {
      expect(
        loadAndValidateRenderTests(feature.getContextPath()).tests[0].args,
      ).toEqual({ use_private_modules: 'always()' })
    } finally {
      await feature.remove()
    }

  })

  it("Rejects a test that declares neither cr nor claim", async function(){

    const feature = await featureWithTests([
      'tests:',
      '  - name: test1',
    ].join('\n'))

    try {
      expect(() =>
        loadAndValidateRenderTests(feature.getContextPath()),
      ).toThrow(/cr/)
    } finally {
      await feature.remove()
    }

  })

  it("Rejects an unknown key on a test entry", async function(){

    const feature = await featureWithTests([
      'tests:',
      '  - name: test1',
      '    cr: "../../generic-fixtures/cr.yaml"',
      '    bogus: nope',
    ].join('\n'))

    try {
      expect(() =>
        loadAndValidateRenderTests(feature.getContextPath()),
      ).toThrow(/additional propert/)
    } finally {
      await feature.remove()
    }

  })

  it("Rejects a test entry with no name", async function(){

    const feature = await featureWithTests([
      'tests:',
      '  - cr: "../../generic-fixtures/cr.yaml"',
    ].join('\n'))

    try {
      expect(() =>
        loadAndValidateRenderTests(feature.getContextPath()),
      ).toThrow(/name/)
    } finally {
      await feature.remove()
    }

  })

  it("Rejects an empty tests array", async function(){

    const feature = await featureWithTests('tests: []')

    try {
      expect(() =>
        loadAndValidateRenderTests(feature.getContextPath()),
      ).toThrow()
    } finally {
      await feature.remove()
    }

  })

  it("Rejects duplicate test names", async function(){

    const feature = await featureWithTests([
      'tests:',
      '  - name: test1',
      '    cr: "../../generic-fixtures/cr.yaml"',
      '  - name: test1',
      '    cr: "../../generic-fixtures/other.yaml"',
    ].join('\n'))

    try {
      expect(() =>
        loadAndValidateRenderTests(feature.getContextPath()),
      ).toThrow(/Duplicate test name/)
    } finally {
      await feature.remove()
    }

  })

  it("Rejects a feature with no render_tests.yaml", async function(){

    const feature = await createRenderContext('render-tests-')

    try {
      expect(() =>
        loadAndValidateRenderTests(feature.getContextPath()),
      ).toThrow(/render_tests.yaml is required but not found/)
    } finally {
      await feature.remove()
    }

  })

})
