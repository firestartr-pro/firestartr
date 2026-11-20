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

    this.assertProviderForOrg();

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

    this.assertProviderForOrg();

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

  // The pinned module takes no organization input: Terraform targets the
  // organization of the provider's owner. A claim whose spec.org disagrees
  // with that owner would discover imports in one organization while
  // creating the ruleset in another, so fail fast on the mismatch.
  private assertProviderForOrg(): void {
    const { org } = this.cr.spec;

    let owner: any;

    try {
      owner = JSON.parse(this.provider.cr.spec.config).owner;
    } catch {
      // The owner may be set through the provider's inline block or env
      // instead of its config: it cannot be checked here.
      return;
    }

    if (owner && owner !== org) {
      throw new Error(
        `[gh-provisioner] ${this.k8sId}: the provider's owner "${owner}" does not match spec.org "${org}": the ruleset would target the wrong organization`,
      );
    }
  }
}
