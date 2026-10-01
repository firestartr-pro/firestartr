import { Entity, PatchOperations } from '../../base';

import log from '../../../logger';

import { EntityGHRepo } from '../';

export async function provisionVariables(fsGithubRepository: EntityGHRepo) {
  const sections = ['actions'];

  const cr = fsGithubRepository.cr;

  if ('vars' in cr.spec) {
    const vars = cr.spec.vars;

    for (const section of sections) {
      if (section in vars) {
        for (const repoVar of vars[section]) {
          let plainTextSecret = '';

          log.info(`Provisioning repo var ${repoVar.name} for ${cr.name}`);

          if ('ref' in repoVar) {
            const secretRef = Entity.refResolver({
              name: repoVar.ref.name,
              kind: 'Secret',
            });

            if (!secretRef) {
              log.warn(
                `[gh-provisioner] ${cr.name} could not resolve secret ref ${repoVar.ref.name}, skipping`,
              );
              continue;
            }

            plainTextSecret = secretRef.getOutput(repoVar.ref.key);
          }

          await provisionRepositoryVar(
            fsGithubRepository,
            section,
            repoVar.name,
            plainTextSecret ? plainTextSecret : repoVar.value,
          );
        }
      }
    }
  } else {
    //  log.info(`FirestartrGithubRepository ${fsGithubRepository.metadata.name} does not have a vars section`)
  }
}

async function provisionRepositoryVar(
  repo: EntityGHRepo,
  section: string,
  repoVarName: string,
  value: any,
) {
  log.debug(
    `[gh-provisioner] ${repo.k8sId} Provisioning repo var ${section}/${repoVarName}`,
  );

  const varClass = section === 'actions' ? true : null;

  if (varClass) {
    const vc = {
      variableName: repoVarName,

      value,
    };

    repo.patchData({
      op: PatchOperations.add,

      path: '/config/variables/-',

      value: vc,
    });

    log.info(
      `[gh-provisioner] ${repo.k8sId} repo var ${section}/${repoVarName} added`,
    );
  }
}
