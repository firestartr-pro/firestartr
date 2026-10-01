import Debug from 'debug';
import * as fs from 'fs';

function objectToMarkdownTable(data: Record<string, any>[]): string {
  if (data.length === 0) {
    return ''; // Return an empty string if the array is empty
  }

  const keys = Object.keys(data[0]);
  let markdown = '';

  // Generate the table headers
  markdown += '|' + keys.map((key) => ` ${key} `).join('|') + '|\n';
  markdown += '|' + keys.map(() => '-----------').join('|') + '|\n';

  // Generate the table rows
  for (const item of data) {
    markdown += '|' + keys.map((key) => ` ${item[key]} `).join('|') + '|\n';
  }

  // Add an empty line after the table
  markdown += '\n';

  return markdown;
}

/*
    This interface is used to abstract the logger, so we can use it
    in different contexts (local, github actions, etc). If local is just a wrapper
    around debugger.
*/
export interface Logger {
  logTitle(message: string, level?: number): void;

  logTable(table: any): void;
}

export class LocalLogger implements Logger {
  private db: Debug.Debugger;

  constructor(db: Debug.Debugger) {
    this.db = db;
  }

  logTitle(message: string, _level = 1): void {
    this.db(message);
  }

  logTable(table: any): void {
    console.table(table);
  }
}

export class GithubLogger implements Logger {
  private summaryFilename: string | undefined;

  constructor() {
    this.summaryFilename = process.env['GITHUB_STEP_SUMMARY'];
  }

  logTitle(message: string, level = 1): void {
    fs.appendFileSync(
      this.summaryFilename!,
      `${'#'.repeat(level)} ${message}\n`,
    );
  }

  logTable(table: any): void {
    fs.appendFileSync(this.summaryFilename!, objectToMarkdownTable(table));
  }
}

export function getLogger(dbg: Debug.Debugger | undefined): Logger {
  if (process.env['GITHUB_ACTIONS']) {
    return new GithubLogger();
  }

  // By default, return a local logger
  return new LocalLogger(dbg ? dbg : Debug('firestartr:common:local-logger'));
}
