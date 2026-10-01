#!/usr/bin/env node

import { execute } from '@oclif/core';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

await execute({dir: join(__dirname, '..')});
