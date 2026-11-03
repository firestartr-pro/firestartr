// Prints the `--org` flag defaults oclif's manifest builder would cache, as
// `<command>=<org>`. orgFlagManifest.test.ts runs it in a child process because
// oclif loads command modules through ES imports, which jest's runtime cannot.
import { Plugin } from '@oclif/core';

const [root, mode] = process.argv.slice(2);
const plugin = new Plugin({
  root,
  type: 'core',
  ignoreManifest: true,
  respectNoCacheDefault: mode !== 'cache',
  errorOnManifestCreate: true,
});
await plugin.load();
const baked = Object.entries(plugin.manifest.commands)
  .filter(([, command]) => command.flags?.org?.default !== undefined)
  .map(([id, command]) => `${id}=${command.flags.org.default}`);
process.stdout.write(`${JSON.stringify(baked)}\n`);
