import { schemas } from '../src/schemas/dot-firestartr';

export const baseURL =
  'https://raw.githubusercontent.com/firestartr-pro/docs/refs/heads/main/site/raw/core/dot-firestartr';

if (process.argv[1]?.endsWith('dot-firestartr-exporter.ts')) {
  console.log(JSON.stringify(schemas, null, 2));
}
