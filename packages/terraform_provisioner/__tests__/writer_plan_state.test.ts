import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';

import {
  PLAN_BACKEND_OVERRIDE_FILE,
  PLAN_STATE_FILE,
  WriterPlanState,
  listsAbsentSnapshotState,
  plansAgainstLiveBackend,
} from '../src/writer_plan_state';

const BACKEND = { kubernetes: { config: { namespace: 'states' } } };

const STATE = JSON.stringify({ version: 4, serial: 3, lineage: 'l', resources: [] });

function secretWith(state: string) {
  return { data: { tfstate: zlib.gzipSync(state).toString('base64') } };
}

describe('WriterPlanState', () => {
  let workspace: string;

  beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-state-'));
    fs.chmodSync(workspace, 0o755);
  });

  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it('plans against an owner-only snapshot of the kubernetes state', async () => {
    const readKubernetesSecret = jest.fn(async () => secretWith(STATE));

    const writer = new WriterPlanState(BACKEND, 'githubrepository/repo', {
      readKubernetesSecret,
    });
    await writer.render();
    writer.writeToTerraformProject(workspace);

    expect(readKubernetesSecret).toHaveBeenCalledWith(
      'states',
      'tfstate-default-githubrepository-repo',
    );

    const statePath = path.join(workspace, PLAN_STATE_FILE);
    expect(fs.readFileSync(statePath, 'utf8')).toBe(STATE);
    expect(fs.statSync(statePath).mode & 0o777).toBe(0o600);
    expect(fs.statSync(workspace).mode & 0o777).toBe(0o700);

    const override = fs.readFileSync(
      path.join(workspace, PLAN_BACKEND_OVERRIDE_FILE),
      'utf8',
    );
    expect(override).toContain('backend "local"');
    expect(override).toContain(`path = "${PLAN_STATE_FILE}"`);
  });

  it('plans against an empty state when the state does not exist yet', async () => {
    const writer = new WriterPlanState(BACKEND, 'ws-key', {
      readKubernetesSecret: async () => null,
    });
    await writer.render();
    writer.writeToTerraformProject(workspace);

    expect(fs.existsSync(path.join(workspace, PLAN_STATE_FILE))).toBe(false);
    expect(
      fs.existsSync(path.join(workspace, PLAN_BACKEND_OVERRIDE_FILE)),
    ).toBe(true);
  });

  it('refuses backends it cannot snapshot read-only', async () => {
    const writer = new WriterPlanState({ gcs: { config: {} } }, 'ws-key', {
      readKubernetesSecret: async () => null,
    });

    await expect(writer.render()).rejects.toThrow(/needs a kubernetes backend/);
  });
});

describe('plansAgainstLiveBackend', () => {
  it('plans only through the aws backend live', () => {
    expect(plansAgainstLiveBackend({ aws: { config: {} } })).toBe(true);
    expect(plansAgainstLiveBackend({ azurerm: { config: {} } })).toBe(false);
    expect(plansAgainstLiveBackend({ gcs: { config: {} } })).toBe(false);
    expect(plansAgainstLiveBackend({ kubernetes: { config: {} } })).toBe(false);
    expect(plansAgainstLiveBackend(undefined)).toBe(false);
  });

  it('refuses an azurerm backend instead of initializing it', async () => {
    const writer = new WriterPlanState({ azurerm: { config: {} } }, 'ws-key', {
      readKubernetesSecret: async () => null,
    });

    await expect(writer.render()).rejects.toThrow(/needs a kubernetes backend/);
  });
});

describe('listsAbsentSnapshotState', () => {
  async function workspaceWith(secret: any): Promise<string> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-state-list-'));
    const writer = new WriterPlanState(BACKEND, 'ws-key', {
      readKubernetesSecret: async () => secret,
    });

    await writer.render();
    writer.writeToTerraformProject(dir);

    return dir;
  }

  it('lists an empty state when the live state does not exist', async () => {
    const dir = await workspaceWith(null);

    expect(listsAbsentSnapshotState(dir, ['state', 'list'])).toBe(true);
    expect(listsAbsentSnapshotState(dir, ['state', 'rm', 'x'])).toBe(false);
  });

  it('runs state list against an existing snapshot', async () => {
    const dir = await workspaceWith(secretWith(STATE));

    expect(listsAbsentSnapshotState(dir, ['state', 'list'])).toBe(false);
  });

  it('never applies to a workspace planned against a live backend', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-state-list-'));

    expect(listsAbsentSnapshotState(dir, ['state', 'list'])).toBe(false);
  });
});
