import * as path from 'path';
import { exec } from 'child_process';
import { randomString } from '../generic/random';

import log from '../logger';

export function cloneCatalog(
  catalogPath: string,
  dest: string = _calculateRandomDestination(),
): Promise<string> {
  log.info(`Cloning catalog from ${catalogPath} to ${dest}`);

  return new Promise((ok: Function, ko: Function) => {
    exec(
      `cp -a ${catalogPath} ${dest}`,
      (error: any, _stdout: any, _stderr: any) => {
        if (error) {
          log.error(`Error cloning catalog: ${error.message}`);
          return ko(error.message);
        } else {
          log.info(`Catalog cloned to successfully to ${dest}`);
          return ok(dest);
        }
      },
    );
  });
}

function _calculateRandomDestination() {
  return path.join('/tmp', 'catalog' + randomString(8));
}
