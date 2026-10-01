#!/usr/bin/env ts-node

import { argv } from 'node:process';

import * as render from '../src/index';

let feature = '';

argv.forEach((val, index) => {
  if (index === 2) feature = val;
});

if (!feature) {
  error('No feature passed to the test');
}

function error(msg: string) {
  throw new Error(msg);
}
