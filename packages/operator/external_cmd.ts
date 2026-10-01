import { fileURLToPath } from 'url';
import { dirname } from 'path';

import util from 'util';

// Provide __dirname globally for all bundled modules
declare global {
  var __filename: string;
  var __dirname: string;
}
globalThis.__filename = fileURLToPath(import.meta.url);
globalThis.__dirname = dirname(globalThis.__filename);

import * as cmd from './src/cmd';

import * as fs from 'fs';
import * as path from 'path';

import commandLineArgs, { CommandLineOptions } from 'command-line-args';
import common from 'catalog_common';
import cdk8s_renderer from 'cdk8s_renderer';

let ctlPlanner: any = null;

const mainOpts = [
  {
    name: 'name',

    defaultOption: true,
  },
  {
    name: 'tool-image-tag',
  },
];

const mainCommand: any = commandLineArgs(mainOpts, {
  stopAtFirstUnknown: true,
}) as CommandLineOptions & {
  name: string;
  file?: string;
  namespace?: string;
  help?: boolean;
  wait?: boolean;
};

const argv = mainCommand._unknown || [];

// control the interruptions
const shutdown = async () => {
  console.log('\n🛑 Shutting down...');

  if (ctlPlanner) await ctlPlanner.ctlCleanUp();

  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Run the corresponding command
switch (mainCommand.name) {
  case 'help':
    console.log('Usage: node cmd.js [command] [options]');
    console.log('Commands:');
    console.log(
      '  plan                Perform planning. It will create a Job in the cluster and run the plan command',
    );
    console.log(
      '  apply               Apply on K8s. It will create a Job in the cluster and run the apply command',
    );
    console.log('  plan-local          Perform local planning');
    console.log('  apply-local         Apply locally');
    console.log('Options:');
    console.log('  -f, --file          Path to the file on your local machine');
    console.log('  -n, --namespace     Kubernetes namespace');
    console.log(
      '  -w, --watch         Waits until the command is cancelled, useful to debug and perform operations inside the pod',
    );
    console.log(
      ' -d, --debug          Enable debug mode. This will launch a job with the plan/apply and keep the pod running',
    );
    break;

  case 'plan':
    void plan(argv);
    break;

  case 'plan-local':
    void planLocal(argv);
    break;

  case 'apply-local':
    void applyLocal(argv);
    break;

  case 'apply':
    void apply(argv);
    break;

  default:
    // Show help if an unknown command is provided
    console.log('Unknown command. Use --help to see the available options.');
    break;
}

async function plan(argv: string[]) {
  let letsWait = false;
  let errorDetected = false;

  try {
    const planOpts = [
      {
        name: 'namespace',

        alias: 'n',

        default: 'default',
      },

      {
        name: 'file',

        alias: 'f',
      },

      {
        name: 'debug',

        alias: 'd',

        type: Boolean,
      },

      {
        name: 'wait',

        alias: 'w',

        type: Boolean,
      },

      {
        name: 'jobTtl',

        alias: 't',

        type: Number,
      },

      {
        name: 'tool-image-tag',
      },
    ];

    const runPlan = commandLineArgs(planOpts, {
      argv,
      stopAtFirstUnknown: true,
    });

    argv = runPlan._unknown || [];

    const file = '';

    if (!runPlan.file) {
      throw new Error('plan: claim file missing');
    }

    let claim: any = common.io.fromYaml(fs.readFileSync(runPlan.file, 'utf-8'));

    claim = await processTfFilesIfNeeded(claim, path.dirname(runPlan.file));

    const tmpFile = '/tmp/claim-' + Date.now() + '.yaml';

    fs.writeFileSync(tmpFile, common.io.toYaml(claim));

    letsWait = runPlan.wait || runPlan.debug;

    await cmd.tfPlanner(
      tmpFile,

      claim,

      runPlan.namespace,

      runPlan.debug,

      runPlan.jobTtl,

      'plan',

      runPlan['tool-image-tag'],

      (ctl: any) => (ctlPlanner = ctl),
    );
  } catch (err) {
    const cleanError = util.inspect(err, {
      showHidden: false,
      depth: 1,
      colors: false,
    });
    console.error(cleanError);
    errorDetected = true;
  }

  // we wait until explicit cancellation
  if (letsWait && !errorDetected) {
    await waitUntilEndTimes();
  }

  if (ctlPlanner) {
    await ctlPlanner.ctlCleanUp();
  }
}

async function waitUntilEndTimes() {
  const fWait = () => new Promise((ok) => setTimeout(ok, 2 * 1000));

  while (true) {
    await fWait();
  }
}

async function processTfFilesIfNeeded(claim: any, claimPath: string) {
  if (!claim?.providers?.terraform?.tfStateKey) {
    throw new Error('❌ tfStateKey is required');
  }

  if (
    claim.providers.terraform.source.toLowerCase() === 'inline' &&
    !claim.providers.terraform.module
  ) {
    const content = await cdk8s_renderer.normalizeModuleContent(claimPath);

    claim.providers.terraform.module = content;
  }
  return claim;
}

async function planLocal(argv: string[]) {
  const planOpts = [
    {
      name: 'namespace',

      alias: 'n',

      default: 'default',
    },

    {
      name: 'file',

      alias: 'f',
    },
  ];

  const runPlanLocal = commandLineArgs(planOpts, {
    argv,
    stopAtFirstUnknown: true,
  });

  argv = runPlanLocal._unknown || [];

  let file = '';

  if (!runPlanLocal.file) {
    throw new Error('plan-local: Falta el fichero del cr');
  }

  file = await helperSlurpFile(
    runPlanLocal.file,
    `No se pudo abrir '${runPlanLocal.file}'`,
  );

  await cmd.tfLocal(
    common.io.fromYaml(file),

    runPlanLocal.namespace,
  );
}

async function apply(argv: string[]) {
  const planOpts = [
    {
      name: 'namespace',

      alias: 'n',

      default: 'default',
    },

    {
      name: 'file',

      alias: 'f',
    },

    {
      name: 'debug',

      alias: 'd',

      type: Boolean,
    },
  ];

  const runApply = commandLineArgs(planOpts, {
    argv,
    stopAtFirstUnknown: true,
  });

  argv = runApply._unknown || [];

  let file = '';

  if (!runApply.file) {
    throw new Error('apply: cr file missing');
  }

  file = await helperSlurpFile(
    runApply.file,
    `Can´t open file: '${runApply.file}'`,
  );

  let claim: any = common.io.fromYaml(file);

  claim = await processTfFilesIfNeeded(claim, path.dirname(runApply.file));

  const tmpFile = '/tmp/claim-' + Date.now() + '.yaml';

  fs.writeFileSync(tmpFile, common.io.toYaml(claim));

  await cmd.tfPlanner(
    tmpFile,

    claim,

    runApply.namespace,

    runApply.debug,

    undefined,

    'apply',

    runApply['tool-image-tag'],
  );
}

async function applyLocal(argv: string[]) {
  const planOpts = [
    {
      name: 'namespace',

      alias: 'n',

      default: 'default',
    },

    {
      name: 'file',

      alias: 'f',
    },
  ];

  const applyLocal = commandLineArgs(planOpts, {
    argv,
    stopAtFirstUnknown: true,
  });

  argv = applyLocal._unknown || [];

  let file = '';

  if (!applyLocal.file) {
    throw new Error('apply: Falta el fichero del cr');
  }

  file = await helperSlurpFile(
    applyLocal.file,
    `No se pudo abrir '${applyLocal.file}'`,
  );

  await cmd.tfLocal(
    common.io.fromYaml(file),

    applyLocal.namespace,

    'apply',
  );
}

function helperSlurpFile(filePath: string, error: string): Promise<string> {
  return new Promise((ok: Function) => {
    fs.readFile(filePath, 'utf-8', (err: any, data: string) => {
      if (err) throw err;
      else ok(data);
    });
  });
}
