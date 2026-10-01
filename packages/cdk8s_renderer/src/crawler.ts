import * as fs from 'node:fs/promises';
import * as path from 'path';

// Number of files being currently slurped
let activeSlurps = 0;

// Max number of files that can be being slurped at a given time
const LIMIT_SLURPS = 10;

// Function to wait a certain number of miliseconds. Default: 100
const f_wait = (ms = 100) => new Promise((ok) => setTimeout(ok, ms));

function isPathExcluded(entry: string, excludedPaths: string[]) {
  return (
    excludedPaths.filter((excludedPath: string) => {
      const relative = path.relative(excludedPath, entry);

      return (
        relative && !relative.startsWith('..') && !path.isAbsolute(relative)
      );
    }).length > 0
  );
}

export async function crawlWithExclusions(
  dir: string,
  filter: Function,
  exec: Function,
  excludedPaths: string[] = [],
) {
  try {
    return crawl(
      dir,

      (entry: string) => {
        // If the file is in the excluded paths, we don't want to crawl it
        if (isPathExcluded(entry, excludedPaths)) {
          return false;
        } else {
          return filter(entry);
        }
      },

      exec,
    );
  } catch (err: any) {
    throw `Crawling with exclusions: ${dir}: ${err}`;
  }
}

/*
 * Function that recursively checks a folder and its subfolders,
 * filtering their files and executing a function on each of them.
 *
 * Input:
 * - dir: string, the absolute path to the folder we want to crawl
 * - filter: function, used to filter out unwanted files
 * - exec: function, called once for each file found, passing the filename and
 *   the file contents as parameters
 *
 * This function returns nothing.
 *
 */
export async function crawl(dir: string, filter: Function, exec: Function) {
  try {
    await crawlDirectory(dir, async (entry: string, data: any) => {
      if (filter(entry)) {
        await exec(entry, data);
      }
    });
  } catch (err: any) {
    throw `Crawling ${dir}: ${err}`;
  }
}

/*
 * If there are any open slots, this function reads a file, executes a
 * function on it, then frees up a slot for the next file. Otherwise,
 * it waits until an empty slot is open.
 *
 * Input:
 * - entry: string, the absolute path of the file we want to slurp
 * - exec: function, the function we want to execute on each file
 *
 * Returns:
 * - A promise
 *
 */
async function slurpFile(entry: string, exec: Function) {
  await waitForEmptySlot();

  return fs
    .readFile(entry, 'utf8')
    .then(async (data: any) => {
      /**
       * We need to first free the slot. Otherwise if there is more
       * nested references than the allowed limit, the crawler will
       * hang forever.
       */
      await freeSlot();

      await exec(entry, data);
    })
    .catch(async (err: any) => {
      await f_wait();
      throw err;
    });
}

async function waitForEmptySlot() {
  while (activeSlurps >= LIMIT_SLURPS) {
    await f_wait();
  }

  activeSlurps++;
}

async function freeSlot() {
  activeSlurps--;
}

/*
 * Crawls a given folder. Each subfolder found is also crawled, and
 * each file found is slurped.
 *
 * Input:
 * - dirEnt: string, absolute path of the directory to crawl
 * - exec: function, passed to the slurp method and executed once for each file
 *
 * Returns:
 * - A promise
 *
 */
async function crawlDirectory(dirEnt: string, exec: Function) {
  try {
    const entries = (await fs.readdir(dirEnt))
      .map((entry: string) => path.join(dirEnt, entry))
      .sort();

    for (const entry of entries) {
      const testDir = await isDir(entry);

      if (testDir) {
        await crawlDirectory(entry, exec);
      } else {
        await slurpFile(entry, exec);
      }
    }
  } catch (err: any) {
    throw `crawlDirectory: ${err} on ${dirEnt}`;
  }
}

function isDir(dirEnt: string) {
  return fs
    .stat(dirEnt)

    .then((stat: any) => {
      return stat.isDirectory();
    })

    .catch((err: any) => {
      throw `Stat ${dirEnt}: ${err}`;
    });
}
