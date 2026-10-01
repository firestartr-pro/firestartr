import { cdk8s_rendererSubcommands } from '../src/subcommands/cdk8s_renderer-subcommands';

describe('cdk8s renderer subcommands', () => {
  it('requires paths when generating a claims map', async () => {
    await expect(
      cdk8s_rendererSubcommands.run({ 'generate-claims-map': true }),
    ).rejects.toThrow(
      '--claims and --claims-map-output are required with --generate-claims-map',
    );
  });
});
