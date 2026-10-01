import { Entity, PatchOperations } from '../base';

import log from '../../logger';

import github from 'github';

export class EntityGHOrgVarsSection extends Entity {
  constructor(artifact: any) {
    super(artifact, {
      config: {
        variables: {},
      },
    });
  }

  async loadResources(tfOp: string): Promise<void> {
    log.info(`[gh-provisioner] running ${tfOp} on ${this.k8sId}`);

    try {
      const cr = this.cr;
      const actionsVariables = cr.spec.actionsVariables || [];

      const variables: Record<string, any> = {};

      for (const v of actionsVariables) {
        const entry: Record<string, any> = {
          value: v.value,
          visibility: v.visibility,
        };

        if (v.visibility === 'selected' && v.selectedRepositories) {
          entry.selectedRepositoryIds = v.selectedRepositories;
        }

        variables[v.name] = entry;
      }

      this.patchData({
        op: PatchOperations.replace,
        path: '/config/variables',
        value: variables,
      });

      if (tfOp === 'apply') {
        await this.adoptVariablesIfNeeded(actionsVariables);
      }

      log.debug(`[gh-provisioner] ${this.k8sId} loaded its data`);
    } catch (err: any) {
      const message = err instanceof Error ? err.message : String(err);

      log.error(
        `[gh-provisioner] ${this.k8sId} error loading resources: ${message}`,
      );

      throw new Error(
        `[gh-provisioner] ${this.k8sId} error loading resources: ${message}`,
      );
    }
  }

  private async adoptVariablesIfNeeded(
    declaredVars: Array<{
      name: string;
      value: string;
      visibility: string;
      selectedRepositories?: string[];
    }>,
  ): Promise<void> {
    const cr = this.cr;

    const managedVariables =
      this.cr.fResolveSelfOutputs('managed_variables') || [];

    const declaredNames = declaredVars.map((v) => v.name);
    const newToModule = declaredNames.filter(
      (name) => !managedVariables.includes(name),
    );

    if (newToModule.length === 0) {
      log.debug(
        `[gh-provisioner] ${this.k8sId} all declared variables are already managed, no adoption needed`,
      );
      return;
    }

    if (managedVariables.length === 0) {
      log.info(
        `[gh-provisioner] ${this.k8sId} no managed_variables output — first reconciliation, treating all ${newToModule.length} declared variable(s) as new to module`,
      );
    }

    for (const varName of newToModule) {
      try {
        await this.runWithGithubProvider(async () => {
          await github.org.getOrgVariable(cr.spec.org, varName);
        });

        log.info(
          `[gh-provisioner] ${this.k8sId} adopting pre-existing variable '${varName}' on GitHub org '${cr.spec.org}'`,
        );

        this.patchImportData({
          op: PatchOperations.add,
          path: '/imports/-',
          value: {
            to: `github_actions_organization_variable.this["${varName}"]`,
            id: varName,
          },
        });
      } catch (err: any) {
        if (err && err.status === 404) {
          log.info(
            `[gh-provisioner] ${this.k8sId} variable '${varName}' not found on GitHub org '${cr.spec.org}' — will be created by TFM`,
          );
        } else if (err && (err.status === 401 || err.status === 403)) {
          log.warn(
            `[gh-provisioner] ${this.k8sId} token lacks scope to check variable '${varName}' on org '${cr.spec.org}' — skipping adoption gracefully`,
          );
        } else {
          log.error(
            `[gh-provisioner] ${this.k8sId} unexpected error checking variable '${varName}' on org '${cr.spec.org}': ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }
  }

  async postProvision(tfOp: string): Promise<void> {}

  async loadAddressesToImport(): Promise<void> {}
}
