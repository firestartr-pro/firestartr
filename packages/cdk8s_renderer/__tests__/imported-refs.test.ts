import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import YAML from 'yaml';

import { importedsRefsWalker } from '../src/renderer/imported-refs';
import { RenderClaimData } from '../src/renderer/types';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'imported-refs-test-'));
}

function makeRenderClaimData(claim: any, claimPath: string): RenderClaimData {
  return {
    claim,
    claimPath,
    initializers: [],
    overrides: [],
    globals: [],
    normalizers: [],
  };
}

describe('importedsRefsWalker', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('expands an imported-ref in an object field and writes the claim to disk', async () => {
    const claim = {
      kind: 'UserClaim',
      name: 'test-user',
      spec: {
        owner: 'user-imported-ref:GithubDisplayName',
      },
    };

    const renderClaimData = makeRenderClaimData(claim, tmpDir);

    const symbolsToResolve = importedsRefsWalker(renderClaimData);

    expect(symbolsToResolve.length).toBe(1);

    const solver = async (_type: string, _value: string) => 'user:resolved-user';

    await Promise.all(symbolsToResolve.map((s) => s(solver)));

    // The imported-ref should be expanded in the claim object
    expect(claim.spec.owner).toBe('user:resolved-user');

    // The claim should have been written to disk
    const writtenFile = path.join(tmpDir, 'users', 'test-user.yaml');
    expect(fs.existsSync(writtenFile)).toBe(true);

    const written = YAML.parse(fs.readFileSync(writtenFile, 'utf8'));
    expect(written.spec.owner).toBe('user:resolved-user');
  });

  it('expands an imported-ref in an array element and writes the claim to disk', async () => {
    const claim = {
      kind: 'GroupClaim',
      name: 'my-group',
      spec: {
        members: ['user-imported-ref:Alice', 'user-imported-ref:Bob'],
      },
    };

    const renderClaimData = makeRenderClaimData(claim, tmpDir);

    const symbolsToResolve = importedsRefsWalker(renderClaimData);

    expect(symbolsToResolve.length).toBe(2);

    const solver = async (_type: string, value: string) =>
      `user:${value.toLowerCase().replace(/\s+/g, '-')}`;

    await Promise.all(symbolsToResolve.map((s) => s(solver)));

    expect(claim.spec.members).toEqual(['user:alice', 'user:bob']);

    const writtenFile = path.join(tmpDir, 'groups', 'my-group.yaml');
    expect(fs.existsSync(writtenFile)).toBe(true);

    const written = YAML.parse(fs.readFileSync(writtenFile, 'utf8'));
    expect(written.spec.members).toEqual(['user:alice', 'user:bob']);
  });

  it('expands group imported-refs and writes the claim to disk', async () => {
    const claim = {
      kind: 'ComponentClaim',
      name: 'my-component',
      spec: {
        owner: 'group-imported-ref:My Team',
      },
    };

    const renderClaimData = makeRenderClaimData(claim, tmpDir);

    const symbolsToResolve = importedsRefsWalker(renderClaimData);

    expect(symbolsToResolve.length).toBe(1);

    const solver = async (type: string, value: string) =>
      `${type}:${value.toLowerCase().replace(/\s+/g, '-')}`;

    await Promise.all(symbolsToResolve.map((s) => s(solver)));

    expect(claim.spec.owner).toBe('group:my-team');

    const writtenFile = path.join(tmpDir, 'components', 'my-component.yaml');
    expect(fs.existsSync(writtenFile)).toBe(true);

    const written = YAML.parse(fs.readFileSync(writtenFile, 'utf8'));
    expect(written.spec.owner).toBe('group:my-team');
  });

  it('returns an empty list when no imported-refs are present', () => {
    const claim = {
      kind: 'UserClaim',
      name: 'plain-user',
      spec: {
        owner: 'user:some-owner',
        members: ['user:alice'],
      },
    };

    const renderClaimData = makeRenderClaimData(claim, tmpDir);

    const symbolsToResolve = importedsRefsWalker(renderClaimData);

    expect(symbolsToResolve.length).toBe(0);
  });

  it('expands multiple imported-refs across nested objects and arrays', async () => {
    const claim = {
      kind: 'ComponentClaim',
      name: 'complex-component',
      spec: {
        owner: 'group-imported-ref:Platform Team',
        maintainers: ['user-imported-ref:Dev One', 'user-imported-ref:Dev Two'],
        nested: {
          reviewer: 'user-imported-ref:Lead Dev',
        },
      },
    };

    const renderClaimData = makeRenderClaimData(claim, tmpDir);

    const symbolsToResolve = importedsRefsWalker(renderClaimData);

    expect(symbolsToResolve.length).toBe(4);

    const solver = async (type: string, value: string) =>
      `${type}:${value.toLowerCase().replace(/\s+/g, '-')}`;

    await Promise.all(symbolsToResolve.map((s) => s(solver)));

    expect(claim.spec.owner).toBe('group:platform-team');
    expect(claim.spec.maintainers).toEqual(['user:dev-one', 'user:dev-two']);
    expect((claim.spec as any).nested.reviewer).toBe('user:lead-dev');

    const writtenFile = path.join(tmpDir, 'components', 'complex-component.yaml');
    expect(fs.existsSync(writtenFile)).toBe(true);
  });
});
