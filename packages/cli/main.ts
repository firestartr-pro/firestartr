#!/usr/bin/env node

import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Provide __dirname globally for all bundled modules
(global as any).__filename = fileURLToPath(import.meta.url);
(global as any).__dirname = dirname((global as any).__filename);

import CommandLine from './src/command_line';

import log from './src/logger';

const commandLineArgs = new CommandLine();

commandLineArgs
  .run()
  .then((res) => {
    log.info(`Command done: ${res}`);
  })
  .catch((err) => {
    throw err;
  });
