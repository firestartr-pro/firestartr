import {
  mkdtempSync,
  readFileSync,
  rmSync,
  existsSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse } from 'yaml';
import { schemas } from '../src/schemas/dot-firestartr';
import { baseURL } from '../scripts/dot-firestartr-exporter';

const root = resolve(__dirname, '../../..');
const workflow = parse(
  readFileSync(
    join(root, '.github/workflows/promote_dot_firestartr.yaml'),
    'utf8',
  ),
);
const script = workflow.jobs.promote.steps.find(
  (step: { name?: string }) => step.name === 'Promote schemas',
).run;

test.each([
  ['push', '', 'main', ['main']],
  ['release', 'v3.1.1', '', ['v3.1.1', 'latest']],
  ['release', 'v3.2.0-rc.1', '', ['v3.2.0-rc.1']],
  ['workflow_dispatch', '', 'feat/schema', ['feat/schema']],
])('promotes %s %s %s', (event, tag, branch, targets) => {
  const temporary = mkdtempSync('/tmp/opencode/promotion-');
  try {
    const exported = spawnSync(
      process.execPath,
      [
        join(root, 'node_modules/tsx/dist/cli.mjs'),
        join(
          root,
          'packages/cdk8s_renderer/scripts/dot-firestartr-exporter.ts',
        ),
      ],
      { cwd: root, encoding: 'utf8' },
    );
    expect(exported.status).toBe(0);
    expect(JSON.parse(exported.stdout)).toEqual(schemas);
    const schemasFile = join(temporary, 'schemas.json');
    writeFileSync(schemasFile, exported.stdout);
    const result = spawnSync('bash', ['-eu', '-c', script], {
      cwd: temporary,
      encoding: 'utf8',
      env: {
        ...process.env,
        EVENT_NAME: event,
        RELEASE_TAG: tag,
        BRANCH_NAME: branch,
        SCHEMAS_FILE: schemasFile,
      },
    });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    for (const target of targets) {
      for (const [name, schema] of Object.entries(schemas)) {
        expect(
          JSON.parse(
            readFileSync(
              join(
                temporary,
                `pro-docs/site/raw/core/dot-firestartr/${target}/${name}.schema.json`,
              ),
              'utf8',
            ),
          ),
        ).toEqual({
          ...schema,
          $id: `${baseURL}/${target}/${name}.schema.json`,
        });
      }
    }
    if (tag.includes('-'))
      expect(
        existsSync(
          join(temporary, 'pro-docs/site/raw/core/dot-firestartr/latest'),
        ),
      ).toBe(false);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test.each(['../escape', '/absolute', 'latest', 'v3.1.1', 'feat/../../escape'])(
  'rejects unsafe branch %s',
  (branch) => {
    const result = spawnSync('bash', ['-eu', '-c', script], {
      encoding: 'utf8',
      env: {
        ...process.env,
        EVENT_NAME: 'workflow_dispatch',
        BRANCH_NAME: branch,
      },
    });
    expect(result.status).not.toBe(0);
  },
);
