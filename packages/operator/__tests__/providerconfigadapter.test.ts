import { replaceConfigSecrets, replaceInlineSecrets } from "../src/utils";

describe('ProviderConfig adapter', () => {
    it('should replace inline secrets in provider config', () => {
        const inline = `
        provider "aws" {
            access_key = "\${{ secrets.AWS_ACCESS_KEY }}"
            secret_key = "\${{ secrets.AWS_SECRET_KEY }}"
            region     = "us-west-2"
        }
        `
        const secrets = {
            AWS_ACCESS_KEY: 'my-access-key',
            AWS_SECRET_KEY: 'my-secret-key'
        };

        const result = replaceInlineSecrets(inline, secrets);

        expect(result).toContain('access_key = "my-access-key"');
        expect(result).toContain('secret_key = "my-secret-key"');
        expect(result).toContain('region     = "us-west-2"');
    });

    it('should replace secrets in config object', () => {
        const config = {
            access_key: "${{ secrets.AWS_ACCESS_KEY }}",
            secret_key: "${{ secrets.AWS_SECRET_KEY }}",
            region: "us-west-2",
        };
        const secrets = {
            AWS_ACCESS_KEY: 'my-access-key',
            AWS_SECRET_KEY: 'my-secret-key',
        };

        const result = replaceConfigSecrets(config, secrets);

        expect(result).toEqual({
            access_key: "my-access-key",
            secret_key: "my-secret-key",
            region: "us-west-2",
        });
    });

});
