import { initSystemFS } from '../src';

import path from 'path';

import { Entity, PatchOperations } from '../src/entities/base';
import { EntityGroup } from '../src/entities/group';

import {
  buildContext,
  calculateTFStatePath,
  runOnTerraform,
} from '../src/tp_bridge';

jest.mock('terraform_provisioner', () => ({
  runTerraformProvisioner: jest.fn(),
}));

import { runTerraformProvisioner } from 'terraform_provisioner';

const mockRunTerraformProvisioner = runTerraformProvisioner as jest.Mock;

describe("Terraform Provisioner's Bridge", () => {

    let entity: EntityGroup;

    jest.setTimeout(300000);

    beforeEach(async () => {
    
        entity = await initSystemFS(

            path.join(__dirname, "fixtures/group/cr.yaml"),
        
            path.join(__dirname, "fixtures/group/deps.yaml"),
        
        ) as EntityGroup
    })

    it("is able to build a context for a Group Entity", async () => {
    
        await entity.loadResources()

        const context = buildContext(entity)

    })

    it.skip("is able to build a terraform project", async () => {
 
        jest.setTimeout(10 *1000)

        await entity.loadResources()
    
        await runOnTerraform(entity, 'debug')
    
    })

})

function mockEntity(kind: string, tfStateKey: string): Entity {
  return {
    cr: {
      kind,
      name: 'example',
      spec: {firestartr: {tfStateKey}},
    },
    k8sId: `${kind}/example`,
  } as unknown as Entity;
}

describe('runOnTerraform apply routing', () => {
  let entity: Entity;

  beforeEach(async () => {
    entity = (await initSystemFS(
      path.join(__dirname, 'fixtures/ghrepo/cr.yaml'),
      path.join(__dirname, 'fixtures/ghrepo/deps.yaml'),
    )) as Entity;
    mockRunTerraformProvisioner.mockReset();
    mockRunTerraformProvisioner.mockResolvedValue('apply output');
  });

  it.each(['apply', 'plan-artifact'])(
    'runs %s with importMode=true when import entries are pending',
    async (command) => {
      entity.patchImportData({
        op: PatchOperations.add,
        path: '/imports/-',
        value: {
          to: 'github_issue_label.this["label1"]',
          id: 'test-repo:label1',
        },
      });

      await runOnTerraform(entity, command);

      expect(mockRunTerraformProvisioner).toHaveBeenCalledTimes(1);
      expect(mockRunTerraformProvisioner).toHaveBeenCalledWith(
        expect.objectContaining({ importMode: true }),
        command,
        null,
        expect.objectContaining({
          imports: [
            expect.objectContaining({
              to: 'github_issue_label.this["label1"]',
              id: 'test-repo:label1',
            }),
          ],
        }),
        undefined,
      );
    },
  );

  it('passes the entity plan excludes in the provisioner context', async () => {
    entity.planExcludes = ['github_repository_file.user_managed["README.md/main"]'];

    await runOnTerraform(entity, 'plan-destroy-artifact');

    expect(mockRunTerraformProvisioner).toHaveBeenCalledWith(
      expect.objectContaining({ planExcludes: entity.planExcludes }),
      'plan-destroy-artifact',
      null,
      undefined,
      undefined,
    );
  });

  it('does not carry imports into a destroy artifact plan', async () => {
    entity.patchImportData({
      op: PatchOperations.add,
      path: '/imports/-',
      value: {
        to: 'github_issue_label.this["label1"]',
        id: 'test-repo:label1',
      },
    });

    await runOnTerraform(entity, 'plan-destroy-artifact');

    expect(mockRunTerraformProvisioner).toHaveBeenCalledWith(
      expect.objectContaining({ importMode: false }),
      'plan-destroy-artifact',
      null,
      undefined,
      undefined,
    );
  });

  it('runs a plain apply when there are no pending imports', async () => {
    await runOnTerraform(entity, 'apply');

    expect(mockRunTerraformProvisioner).toHaveBeenCalledTimes(1);
    expect(mockRunTerraformProvisioner).toHaveBeenCalledWith(
      expect.objectContaining({ importMode: false }),
      'apply',
      null,
      undefined,
      undefined,
    );
  });

  it('does not consume imports for non-apply commands', async () => {
    entity.patchImportData({
      op: PatchOperations.add,
      path: '/imports/-',
      value: {
        to: 'github_issue_label.this["label1"]',
        id: 'test-repo:label1',
      },
    });

    await runOnTerraform(entity, 'destroy');

    expect(mockRunTerraformProvisioner).toHaveBeenCalledTimes(1);
    expect(mockRunTerraformProvisioner).toHaveBeenCalledWith(
      expect.objectContaining({ importMode: false }),
      'destroy',
      null,
      undefined,
      undefined,
    );
  });

  it("bounds discovery commands with the run's timeout controller", async () => {
    const ctl = { hardTimeout: 10, processKilled: jest.fn() };
    entity.tfCtl = ctl;

    await runOnTerraform(entity, 'custom-command', ['state', 'list']);

    expect(mockRunTerraformProvisioner).toHaveBeenCalledWith(
      expect.anything(),
      'custom-command',
      null,
      ['state', 'list'],
      ctl,
    );
  });
});

describe('calculateTFStatePath', () => {
  it('keeps kubernetes backend labels within 63 characters', () => {
    const uuid = '409cbd6d-2b40-44f1-99ba-180d6fad4f37';
    const statePath = calculateTFStatePath(
      mockEntity('FirestartrGithubOrganizationSettings', uuid),
      {kubernetes: {}},
    );

    expect(statePath.split('/').join('-')).toHaveLength(63);
    expect(statePath.endsWith(uuid)).toBe(true);
  });

  it('keeps existing exact-fit kubernetes state paths unchanged', () => {
    const uuid = '3914ca50-cc80-4961-a139-464028818a92';

    expect(
      calculateTFStatePath(mockEntity('FirestartrGithubRepository', uuid), {
        kubernetes: {},
      }),
    ).toBe(`firestartrgithubrepository/${uuid}`);
  });

  it('keeps non-kubernetes state paths unchanged', () => {
    const uuid = '409cbd6d-2b40-44f1-99ba-180d6fad4f37';

    expect(
      calculateTFStatePath(
        mockEntity('FirestartrGithubOrganizationSettings', uuid),
        {aws: {}},
      ),
    ).toBe(`firestartrgithuborganizationsettings/${uuid}`);
  });
});
