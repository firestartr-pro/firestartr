import * as fs from 'fs';

export function isDirectory(path: string) {
  return fs.existsSync(path) && fs.lstatSync(path).isDirectory();
}

export function isFile(path: string) {
  return fs.existsSync(path) && fs.lstatSync(path).isFile();
}

export function slurpFile(path: string) {
  if (!isFile(path)) {
    throw `File not found ${path}`;
  }

  return fs.readFileSync(path, { encoding: 'utf-8' });
}
