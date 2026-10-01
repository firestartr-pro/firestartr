import path from 'path';
import { WriterMainTf } from '../src/writer_main_tf';
import { WriterProviderJson } from '../src/writer_provider_tf_json';
import * as fs from 'fs'

/**
 * Inline terraform main block
 */
const mainBlock =
`resource "azurerm_resource_group" "example" {
    name     = "example-resources"
    location = "West Europe"
}`

describe('Terraform render', () => {

  function prepareProviderWithConfig(config: any) {
    return _prepareProvider(config, "")
  }

  function prepareProviderWithInline(inline: string) {
    return _prepareProvider({}, inline)
  }

  function _prepareProvider(config: any, inline: string) {
    return {
      name: "azurerm",
      source: "hashicorp/azurerm",
      version: "~> 2.0",
      config: config,
      inline: inline,
    }
  }

  async function renderAndCheck(
    mainBlock: string,
    providers: any[],
    expectedMainTf: string,
    expectedProviderJson: string,
  ) {
    const writer = new WriterMainTf(mainBlock, providers, null, "test-key")
    const maintf = await writer.render()

    const jsonWriter = new WriterProviderJson(mainBlock, providers, null, "test-key")
    const providerjson = await jsonWriter.render()

    expect(maintf).toEqual(expectedMainTf)
    expect(providerjson).toEqual(expectedProviderJson)
  }

  it('can render a provider with a config field', async () => {
    /**
     * Expected main.tf
     */
    const expectedMainTf = fs.readFileSync(
      path.join(__dirname, "fixtures", "main.tf"), "utf-8"
    ).trim()
    const expectedProviderJson = fs.readFileSync(
      path.join(__dirname, "fixtures", "provider.tf.json"), "utf-8"
    ).trim()

    const providers = [prepareProviderWithConfig({
        features: {},
        subscription_id: "00000000-0000-0000-0000-000000000000",
        client_id: "00000000-0000-0000-0000-000000000000",
        client_secret: "00000000-0000-0000-0000-000000000000",
        tenant_id: "00000000-0000-0000-0000-000000000000",
        use_msi: false,
      })]

    await renderAndCheck(
      mainBlock, providers, expectedMainTf, expectedProviderJson,
    )
  });


  it('can render a provider with an inline field', async () => {
    /**
     * Expected main.tf
     */
    const expectedMainTf = fs.readFileSync(path.join(__dirname, "fixtures", "main-inline.tf"), "utf-8")
    const expectedProviderJson = ''

    const providers = [prepareProviderWithInline(`
provider "azurerm" {
    features {}
    subscription_id = "00000000-0000-0000-0000-000000000000"
    client_id       = "00000000-0000-0000-0000-000000000000"
    client_secret   = "00000000-0000-0000-0000-000000000000"
    tenant_id       = "00000000-0000-0000-0000-000000000000"
    use_msi        = false
}`)]

    await renderAndCheck(
      mainBlock, providers, expectedMainTf, expectedProviderJson,
    )
  });


  it('can render multiple providers with a config field', async () => {
    const expectedMainTf = fs.readFileSync(
      path.join(__dirname, "fixtures", "main.tf"), "utf-8"
    ).trim()
    const expectedProviderJson = fs.readFileSync(
      path.join(__dirname, "fixtures", "multiple-providers.tf.json"), "utf-8"
    ).trim()

    const providers = [
      prepareProviderWithConfig({
        features: {},
        subscription_id: "00000000-0000-0000-0000-000000000000",
        client_id: "00000000-0000-0000-0000-000000000000",
        client_secret: "00000000-0000-0000-0000-000000000000",
        tenant_id: "00000000-0000-0000-0000-000000000000",
        use_msi: false,
      }),
      prepareProviderWithConfig({
        features: {},
        subscription_id: "11111111-1111-1111-1111-111111111111",
        client_id: "11111111-1111-1111-1111-111111111111",
        client_secret: "11111111-1111-1111-1111-111111111111",
        tenant_id: "11111111-1111-1111-1111-111111111111",
        use_msi: true,
        alias: "secondary",
      }),
    ]

    await renderAndCheck(
      mainBlock, providers, expectedMainTf, expectedProviderJson,
    )
  });


  it('can render multiple providers with an inline fields', async () => {
    const expectedMainTf = fs.readFileSync(
      path.join(__dirname, "fixtures", "multiple-inline-main.tf"), "utf-8"
    ).trim()
    const expectedProviderJson = ''

    const providers = [
      prepareProviderWithInline(`
provider "azurerm" {
    features {}
    subscription_id = "00000000-0000-0000-0000-000000000000"
    client_id       = "00000000-0000-0000-0000-000000000000"
    client_secret   = "00000000-0000-0000-0000-000000000000"
    tenant_id       = "00000000-0000-0000-0000-000000000000"
    use_msi        = false
}`),
      prepareProviderWithInline(`
provider "azurerm" {
    features {}
    subscription_id = "11111111-1111-1111-1111-111111111111"
    client_id       = "11111111-1111-1111-1111-111111111111"
    client_secret   = "11111111-1111-1111-1111-111111111111"
    tenant_id       = "11111111-1111-1111-1111-111111111111"
    use_msi        = false
    alias          = "secondary"
}`)
    ]

    await renderAndCheck(
      mainBlock, providers, expectedMainTf, expectedProviderJson,
    )
  });

  it('can render multiple provider with both config and inline fields', async () => {
    const expectedMainTf = fs.readFileSync(
      path.join(__dirname, "fixtures", "multiple-inline-main.tf"), "utf-8"
    ).trim()
    const expectedProviderJson = fs.readFileSync(
      path.join(__dirname, "fixtures", "multiple-providers.tf.json"), "utf-8"
    ).trim()

    const providers = [
      prepareProviderWithConfig({
        features: {},
        subscription_id: "00000000-0000-0000-0000-000000000000",
        client_id: "00000000-0000-0000-0000-000000000000",
        client_secret: "00000000-0000-0000-0000-000000000000",
        tenant_id: "00000000-0000-0000-0000-000000000000",
        use_msi: false,
      }),
      prepareProviderWithConfig({
        features: {},
        subscription_id: "11111111-1111-1111-1111-111111111111",
        client_id: "11111111-1111-1111-1111-111111111111",
        client_secret: "11111111-1111-1111-1111-111111111111",
        tenant_id: "11111111-1111-1111-1111-111111111111",
        use_msi: true,
        alias: "secondary",
      }),
      prepareProviderWithInline(`
provider "azurerm" {
    features {}
    subscription_id = "00000000-0000-0000-0000-000000000000"
    client_id       = "00000000-0000-0000-0000-000000000000"
    client_secret   = "00000000-0000-0000-0000-000000000000"
    tenant_id       = "00000000-0000-0000-0000-000000000000"
    use_msi        = false
}`),
      prepareProviderWithInline(`
provider "azurerm" {
    features {}
    subscription_id = "11111111-1111-1111-1111-111111111111"
    client_id       = "11111111-1111-1111-1111-111111111111"
    client_secret   = "11111111-1111-1111-1111-111111111111"
    tenant_id       = "11111111-1111-1111-1111-111111111111"
    use_msi        = false
    alias          = "secondary"
}`),
    ]

    await renderAndCheck(
      mainBlock, providers, expectedMainTf, expectedProviderJson,
    )
  });
});
