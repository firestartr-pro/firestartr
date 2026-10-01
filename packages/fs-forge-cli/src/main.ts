#!/usr/bin/env node

import { execute } from '@oclif/core';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

await execute({ dir: join(__dirname, '..') });
