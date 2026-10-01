import { Entity, PatchOperations } from '../base';

import { EntityGHRepositorySecretsSection } from '.';

import { ResolvedRef } from '../../refs';

import github from 'github';

import { RepoSecretsSection } from 'github';

import crypto from 'crypto';

import log from '../../logger';

export async function provisionRepositorySecrets(
  grss: EntityGHRepositorySecretsSection,
  repo: ResolvedRef,
) {
  log.info(`[gh-provisioner] ${grss.k8sId} provisioning secrets`);

  const sections: RepoSecretsSection[] = [
    'actions',
    'codespaces',
    'dependabot',
  ];

  if ('secrets' in grss.cr.spec) {
    const secrets = grss.cr.spec.secrets;

    for (const section of sections) {
      if (section in secrets) {
        for (const secret of secrets[section]) {
          await provisionRepositorySecret(
            grss,
            section,
            secret.name,
            secret.ref,
            repo,
          );
        }
      }
    }
  } else {
    log.info(`[gh-provisioner] ${grss.k8sId} does not have a secrets section`);
  }
}

async function provisionRepositorySecret(
  grss: EntityGHRepositorySecretsSection,
  section: RepoSecretsSection,
  repoSecretName: string,
  secretRef: any,
  repoResource: ResolvedRef,
) {
  log.info(
    `[gh-provisioner] Provisioning repo secret ${grss.k8sId}/${section}/${repoSecretName}`,
  );

  const secretGeneratorFunction =
    section === 'actions'
      ? grss.actionsSecret()
      : section === 'codespaces'
        ? grss.codespacesSecret()
        : section === 'dependabot'
          ? grss.dependabotSecret()
          : null;

  if (secretGeneratorFunction) {
    const fSecretCreation = process.env['AVOID_PROVIDER_SECRET_ENCRYPTION']
      ? createUnencryptedSecret
      : createEncryptedSecret;

    await fSecretCreation(
      grss,
      secretRef,
      secretGeneratorFunction,
      section,
      repoSecretName,
      repoResource,
    );

    log.info(
      `RepoSecret provisioned ${section}-${repoSecretName.toLowerCase()}-secret`,
    );
  }
}

async function createEncryptedSecret(
  grss: EntityGHRepositorySecretsSection,
  secretRef: any,
  secretPatcherFunction: Function,
  section: RepoSecretsSection,
  repoSecretName: string,
  repo: ResolvedRef,
) {
  log.info(
    `[gh-provisioner] generating encrypted secret ${grss.k8sId}/${section}/${repoSecretName}`,
  );

  const plainSecret = Entity.refResolver(secretRef);

  const plainTextSecret = plainSecret.getOutput(secretRef.key);

  const plaintextSha256 = crypto
    .createHash('sha256')
    .update(plainTextSecret)
    .digest('hex');

  const { key_id, encrypted_value } = await encryptSecret(
    grss,
    plainTextSecret,
    section,
    repo,
  );

  secretPatcherFunction({
    secretName: repoSecretName,
    repository: repo.getDepName(),
    encryptedValue: encrypted_value,
  });

  grss.patchData({
    path: `/config/${section}_sha256/${repoSecretName}`,
    op: PatchOperations.add,
    value: plaintextSha256,
  });
}

async function createUnencryptedSecret(
  grss: EntityGHRepositorySecretsSection,
  secretRef: any,
  secretPatcherFunction: Function,
  section: RepoSecretsSection,
  repoSecretName: string,
  repo: ResolvedRef,
) {
  log.info(
    `[gh-provisioner] generating unencrypted secret ${grss.k8sId}/${section}/${repoSecretName}`,
  );

  const plainSecret = Entity.refResolver(secretRef);

  const plainTextSecret = plainSecret.getOutput(secretRef.key);

  secretPatcherFunction({
    secretName: repoSecretName,
    repository: repo.getDepName(),
    plaintextValue: plainTextSecret,
  });
}

async function encryptSecret(
  grss: EntityGHRepositorySecretsSection,
  plainTextSecret: string,
  section: RepoSecretsSection,
  repo: ResolvedRef,
): Promise<any> {
  const v = await grss.runWithGithubProvider(async () => {
    return await github.encryption.encryptRepoSecret(
      repo.cr.spec.org,
      repo.getDepName(),
      section,
      plainTextSecret,
    );
  });

  return v;
}
