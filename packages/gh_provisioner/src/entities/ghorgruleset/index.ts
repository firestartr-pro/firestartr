import { Entity, PatchOperations } from '../base';

import type { Dependencies } from '../../refs';

import { getResolvedProviderConfig } from '../../providers';

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

    this.patchData({
      path: '/config',
      op: PatchOperations.replace,
      value: this.rulesetConfig(),
    });

    log.debug(`[gh-provisioner] ${this.k8sId} loaded its data`);
  }

  // Team bypass actors reference a FirestartrGithubGroup CR instead of
  // carrying a GitHub slug or a numeric id. The renderer resolved the claim to
  // that CR, so this execution only needs to turn the ref into the team id the
  // module expects. Resolving here makes a missing group or outputs secret
  // fail before the plan instead of inside a Terraform data source.
  private rulesetConfig(): any {
    const ruleset = this.cr.spec.ruleset;

    if (!ruleset.bypass_actors) return ruleset;

    return {
      ...ruleset,
      bypass_actors: ruleset.bypass_actors.map((actor: any) => {
        if (!actor.ref) return actor;

        if (actor.actor_type !== 'Team') {
          throw new Error(
            `[gh-provisioner] ${this.k8sId}: ${actor.actor_type} bypass actors cannot reference another CR`,
          );
        }

        if (actor.ref.kind !== 'FirestartrGithubGroup') {
          throw new Error(
            `[gh-provisioner] ${this.k8sId}: Team bypass actor references ${actor.ref.kind}/${actor.ref.name}; expected FirestartrGithubGroup`,
          );
        }

        const { ref, ...rest } = actor;

        return {
          ...rest,
          actor_id: this.requireOutput(ref, 'id'),
        };
      }),
    };
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
  // with that owner, or whose owner cannot be verified, would discover
  // imports in one organization while creating the ruleset in another, so
  // fail fast instead of guessing.
  private assertProviderForOrg(): void {
    const { org } = this.cr.spec;

    // The Terraform writer uses the inline block instead of the config, so
    // the config owner (and this check) says nothing about what Terraform
    // will use.
    if (this.provider.cr.spec.inline) {
      throw new Error(
        `[gh-provisioner] ${this.k8sId}: the provider uses inline configuration, so its owner cannot be verified against spec.org "${org}"; define the owner in the provider config instead`,
      );
    }

    // Resolved the same way Terraform execution resolves it, so a
    // Secret-backed owner ("${{ secrets.OWNER }}") compares by value.
    const { config } = getResolvedProviderConfig(this, this.provider);

    if (!config.owner) {
      throw new Error(
        `[gh-provisioner] ${this.k8sId}: the provider config does not define owner, so the ruleset organization cannot be verified against spec.org "${org}"`,
      );
    }

    if (config.owner !== org) {
      throw new Error(
        `[gh-provisioner] ${this.k8sId}: the provider's owner "${config.owner}" does not match spec.org "${org}": the ruleset would target the wrong organization`,
      );
    }
  }
}
