import { Entity, PatchOperations } from '../base';

import type { Dependencies } from '../../refs';

import github from 'github';

import log from '../../logger';

// Deleting the CR destroys the ruleset, so every repository it covered loses
// that protection at once.
export class EntityGHOrgRuleset extends Entity {
  constructor(artifact: any, deps?: Dependencies) {
    super(
      artifact,
      {
        config: {},
      },
      deps,
    );
  }

  async loadResources(tfOp: string): Promise<void> {
    log.info(`[gh-provisioner] running ${tfOp} on ${this.k8sId}`);

    // spec.ruleset already has the shape of the module's config
    this.patchData({
      path: '/config',
      op: PatchOperations.replace,
      value: this.cr.spec.ruleset,
    });

    log.debug(`[gh-provisioner] ${this.k8sId} loaded its data`);
  }

  async postProvision(tfOp: string): Promise<void> {}

  async loadAddressesToImport(): Promise<void> {
    const { org, ruleset } = this.cr.spec;

    log.info(`[gh-provisioner] loading addresses to import for ${this.k8sId}`);

    const rulesets = (await this.runWithGithubProvider(async () =>
      github.org.getRulesetList(org),
    )) as any[];

    const matches = rulesets.filter((r) => r.name === ruleset.name);

    if (matches.length > 1) {
      throw `[gh-provisioner] ${this.k8sId}: ${org} has ${matches.length} rulesets named "${ruleset.name}" (ids ${matches.map((m: any) => m.id).join(', ')}), remove the duplicates before importing`;
    }

    if (matches.length === 0) return;

    this.patchImportData({
      op: PatchOperations.add,

      path: '/imports/-',

      value: {
        to: 'github_organization_ruleset.this',
        id: `${matches[0].id}`,
      },
    });
  }
}
