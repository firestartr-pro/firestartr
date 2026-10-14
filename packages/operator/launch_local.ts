import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Provide __dirname globally for all bundled modules
(global as any).__filename = fileURLToPath(import.meta.url);
(global as any).__dirname = dirname((global as any).__filename);

import { runOperator } from '.';
import dotenv from 'dotenv';

dotenv.config();

runOperator({
  ignoreLease: true,
  dummyExec: false,
  withMetrics: true,
  namespace: process.env.NAMESPACE ?? 'default',
  kindList: [
    //'fsdummiesa',
    //'fsdummiesb',
    //'fsdummiesc',
    'githubrepositories',
    'githubrepositoryfeatures',
    'githubmemberships',
    'githubgroups',
    'terraformworkspaces',
    'githuborgwebhooks',
    'githuborganizationsettings',
  ],
});
