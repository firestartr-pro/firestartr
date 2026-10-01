import * as path from 'path'
import * as fs from 'fs'
import { renderFeature, renderFeatureFromPath  } from '../src/renderer';
import common from 'catalog_common'
import { execSync } from 'child_process';

// Create a function to generate a random string for the given length

describe("Render files in multiple directories",() => {

  beforeAll(() => {

    // Create a temporary directory to store the rendered files
    fs.mkdirSync("/tmp/prefapp-features-feature_a-v1.0.0-extract/packages/", { recursive: true })

    execSync(`cp -r ${path.join(__dirname,"fixtures/features/feature_a")} /tmp/prefapp-features-feature_a-v1.0.0-extract/packages/feature_a`)

  })

  afterAll(() => {

   // Remove the temporary directory
   execSync(`rm -rf /tmp/prefap-features-feature_a-v1.0.0-extract`)

  })

  it("should render file", async function () {

    await renderFeature(
      'feature_a',
      'v1.0.0',
      'prefapp',
      'features',
      common.io.fromYaml(fs.readFileSync(path.join(__dirname, `fixtures/mock_catalog/components/repository_a.yaml`), 'utf8')),
      "/tmp",
      {
          foo: "taponcito",
      }
    )
    // make sure the file was created
    const entityFile = fs.readFileSync(path.join(__dirname, `fixtures/mock_catalog/components/repository_a.yaml`), 'utf8')

    const entity = common.io.fromYaml(entityFile)

    const expectedRenderedPath = `${common.features.features.getFeatureRenderedPathForEntity(entity ,"feature_a", "/tmp")}/output.json`

    expect(fs.existsSync(expectedRenderedPath)).toBe(true)

  })

  it("should copy the files based on the variable", async function () {

    await renderFeature(
      'feature_a',
      'v1.0.0',
      'prefapp',
      'features',
      common.io.fromYaml(fs.readFileSync(path.join(__dirname, `fixtures/mock_catalog/components/repository_b.yaml`), 'utf8'))
    )

    const entityFile = fs.readFileSync(path.join(__dirname, `fixtures/mock_catalog/components/repository_b.yaml`), 'utf8')

    const entity = common.io.fromYaml(entityFile)

    const expectedRenderedPath = `${common.features.features.getFeatureRenderedPathForEntity(entity ,"feature_a", "/tmp")}`

    // make sure the file copied is the python one
    let renderedContent = fs.readFileSync(path.join(expectedRenderedPath, ".github/workflows/pr-verify.yaml"), 'utf8')

    const expectedContentFilename = "fixtures/expected_rendering/pr-verify.yaml"

    const expectedContent = fs.readFileSync(path.join(__dirname, expectedContentFilename), 'utf8')

    renderedContent = renderedContent.split(/\n/).slice(5).join("\n")

    expect(renderedContent).toBe(expectedContent)

  })

  it("should render $arg values passed via featureArgs from path", async function () {

    const renderedPath = path.join("/tmp", `feature_arg_rendered_${Date.now()}`);

    try {

      await renderFeatureFromPath(
        path.join(__dirname, 'fixtures/features/feature_arg'),
        renderedPath,
        { name: 'repository_a' },
        { message: 'fromArg' },
      )

      const renderedContent = fs.readFileSync(path.join(renderedPath, 'test.txt'), 'utf8')

      expect(renderedContent).toContain('Hello fromArg')

    } finally {

      fs.rmSync(renderedPath, { recursive: true, force: true })

    }

  })

  it("should throw an error with a non existent technology",async function() {

    try {

      await renderFeature(
        'feature_a',
        'v1.0.0',
        'prefapp',
        'features',
        common.io.fromYaml(fs.readFileSync(path.join(__dirname, `fixtures/mock_catalog/components/repository_c.yaml`), 'utf8'))
      )

    } catch (error:any) {

        expect(error.code).toEqual('ENOENT');

    }

  })

})
