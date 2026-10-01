import common from 'catalog_common';
import { buildContext as buildContextForTFWorkspace } from './tfworkspaces/ctx';
import { Ctx } from './ctx';
import * as fs from 'fs';

export async function execTfCommand(
  command: 'plan' | 'apply',

  filePath: string,

  namespace = 'default',
) {
  console.log(
    `execTfCommand: ${command} claim file path: ${filePath} namespace: ${namespace}`,
  );

  // The claim will be copied to the pod's filesystem
  // and the operator will read it from there
  // The operator should wait fort the claim file to be written
  // before reading it
  console.log(`Waiting for file ${filePath}`);

  await waitForFile(filePath);

  console.log(`File ${filePath} found`);

  const claim: any = common.io.fromYaml(fs.readFileSync(filePath, 'utf8'));

  let ctx: Ctx | null = null;

  switch (claim.kind) {
    case 'TFWorkspaceClaim':
      ctx = await buildContextForTFWorkspace(claim, namespace, command);

      break;

    default:
      throw new Error(`kind "${claim.kind}" not supported`);
  }

  if (!ctx) {
    throw new Error('ctx not found');
  }

  await ctx.exec('resolveDeps');

  await ctx.exec('dryRunExec');

  await ctx.exec('runProvision');
}

function waitForFile(filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => {
        reject(new Error(`File not found within 60 seconds: ${filePath}`));
      },

      60000,
    );

    const interval = setInterval(
      () => {
        if (
          fs.existsSync(filePath + '.size') &&
          fs.existsSync(filePath) &&
          parseInt(fs.readFileSync(filePath + '.size', 'utf8')) ===
            fs.statSync(filePath).size
        ) {
          clearInterval(interval);

          clearTimeout(timeout);

          resolve();
        }
      },

      500,
    );
  });
}
