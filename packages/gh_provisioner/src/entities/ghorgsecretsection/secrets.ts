import { PatchOperations } from '../base';

import type { EntityGHOrgSecretSection } from '.';

import github, { type OrgSecretsSection } from 'github';

import crypto from 'crypto';

import log from '../../logger';

export type SecretEntry = {
  name: string;
  ref: { kind: string; name: string; key: string };
  visibility: string;
  selectedRepositories?: string[];
};

const SECTIONS: OrgSecretsSection[] = ['actions', 'codespaces', 'dependabot'];

export { SECTIONS };

export async function provisionOrgSecrets(
  entity: EntityGHOrgSecretSection,
  secrets: Record<string, SecretEntry[]>,
) {
  log.info(`[gh-provisioner] ${entity.k8sId} provisioning org secrets`);

  const encrypted = !process.env['AVOID_PROVIDER_SECRET_ENCRYPTION'];

  for (const section of SECTIONS) {
    const sectionSecrets: SecretEntry[] = secrets[section] || [];

    if (sectionSecrets.length === 0) continue;

    let preFetchedKey: { key_id: string; key: string } | undefined;

    if (encrypted) {
      try {
        preFetchedKey = await fetchOrgPublicKey(entity, section);
      } catch (err: any) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(
          `[gh-provisioner] ${entity.k8sId} failed to fetch ${section} org public key: ${message}`,
        );
      }
    }

    for (const secret of sectionSecrets) {
      await provisionOrgSecret(entity, section, secret, preFetchedKey);
    }
  }
}

async function fetchOrgPublicKey(
  entity: EntityGHOrgSecretSection,
  section: OrgSecretsSection,
): Promise<{ key_id: string; key: string }> {
  return (await entity.runWithGithubProvider(async () => {
    return await github.encryption.getOrgPublicKey(entity.cr.spec.org, section);
  })) as { key_id: string; key: string };
}

async function provisionOrgSecret(
  entity: EntityGHOrgSecretSection,
  section: OrgSecretsSection,
  secret: SecretEntry,
  preFetchedKey?: { key_id: string; key: string },
) {
  log.info(
    `[gh-provisioner] provisioning org secret ${entity.k8sId}/${section}/${secret.name}`,
  );

  if (process.env['AVOID_PROVIDER_SECRET_ENCRYPTION']) {
    await createUnencryptedSecret(entity, section, secret);
  } else {
    await createEncryptedSecret(entity, section, secret, preFetchedKey);
  }

  log.info(`[gh-provisioner] org secret provisioned ${section}/${secret.name}`);
}

async function createEncryptedSecret(
  entity: EntityGHOrgSecretSection,
  section: OrgSecretsSection,
  secret: SecretEntry,
  preFetchedKey: { key_id: string; key: string },
) {
  const resolved = entity.resolveRef(secret.ref);

  if (!resolved) {
    throw new Error(
      `[gh-provisioner] ${entity.k8sId} cannot resolve secret ref: ${secret.ref.kind}/${secret.ref.name}:${secret.ref.key} — ensure the referenced resource is available as a dependency`,
    );
  }

  const plainTextSecret = resolved.getOutput(secret.ref.key);

  const plaintextSha256 = crypto
    .createHash('sha256')
    .update(plainTextSecret)
    .digest('hex');

  const { encrypted_value } = (await entity.runWithGithubProvider(async () => {
    return await github.encryption.encryptOrgSecret(
      entity.cr.spec.org,
      section,
      plainTextSecret,
      preFetchedKey,
    );
  })) as { key_id: string; encrypted_value: string };

  entity.patchData({
    op: PatchOperations.add,
    path: `/config/${section}/${secret.name}`,
    value: {
      value: encrypted_value,
      visibility: secret.visibility || 'all',
      ...(secret.selectedRepositories && secret.selectedRepositories.length > 0
        ? { selected_repositories: secret.selectedRepositories }
        : {}),
    },
  });

  entity.patchData({
    op: PatchOperations.add,
    path: `/config/${section}_sha256/${secret.name}`,
    value: plaintextSha256,
  });
}

async function createUnencryptedSecret(
  entity: EntityGHOrgSecretSection,
  section: OrgSecretsSection,
  secret: SecretEntry,
) {
  const resolved = entity.resolveRef(secret.ref);

  if (!resolved) {
    throw new Error(
      `[gh-provisioner] ${entity.k8sId} cannot resolve secret ref: ${secret.ref.kind}/${secret.ref.name}:${secret.ref.key} — ensure the referenced resource is available as a dependency`,
    );
  }

  const plainTextSecret = resolved.getOutput(secret.ref.key);

  const plaintextSha256 = crypto
    .createHash('sha256')
    .update(plainTextSecret)
    .digest('hex');

  entity.patchData({
    op: PatchOperations.add,
    path: `/config/${section}/${secret.name}`,
    value: {
      value: plainTextSecret,
      visibility: secret.visibility || 'all',
      ...(secret.selectedRepositories && secret.selectedRepositories.length > 0
        ? { selected_repositories: secret.selectedRepositories }
        : {}),
    },
  });

  entity.patchData({
    op: PatchOperations.add,
    path: `/config/${section}_sha256/${secret.name}`,
    value: plaintextSha256,
  });
}

export async function adoptSecretsIfNeeded(
  entity: EntityGHOrgSecretSection,
  secrets: Record<string, SecretEntry[]>,
): Promise<void> {
  for (const section of SECTIONS) {
    const sectionSecrets: SecretEntry[] = secrets[section] || [];

    if (sectionSecrets.length === 0) continue;

    const managedSecrets: string[] =
      entity.cr.fResolveSelfOutputs(`${section}_secret_names`) || [];
    const declaredNames = sectionSecrets.map((s) => s.name);
    const newToModule = declaredNames.filter(
      (name) => !managedSecrets.includes(name),
    );

    if (newToModule.length === 0) {
      log.debug(
        `[gh-provisioner] ${entity.k8sId} all declared ${section} secrets are already managed`,
      );
      continue;
    }

    if (managedSecrets.length === 0) {
      log.info(
        `[gh-provisioner] ${entity.k8sId} no ${section}_secret_names output — first reconciliation, treating all ${newToModule.length} ${section} secret(s) as new to module`,
      );
    }

    for (const secretName of newToModule) {
      try {
        const existing = (await entity.runWithGithubProvider(async () => {
          return await github.encryption.getOrgSecret(
            entity.cr.spec.org,
            section,
            secretName,
          );
        })) as any;

        if (existing) {
          log.info(
            `[gh-provisioner] ${entity.k8sId} adopting pre-existing ${section} secret '${secretName}' on GitHub org '${entity.cr.spec.org}'`,
          );

          const resourceType = `github_${section}_organization_secret`;

          entity.patchImportData({
            op: PatchOperations.add,
            path: '/imports/-',
            value: {
              to: `${resourceType}.this["${secretName}"]`,
              id: secretName,
            },
          });
        }
      } catch (err: any) {
        if (err && err.status === 404) {
          log.info(
            `[gh-provisioner] ${entity.k8sId} ${section} secret '${secretName}' not found on GitHub org '${entity.cr.spec.org}' — will be created by TFM`,
          );
        } else if (err && (err.status === 401 || err.status === 403)) {
          log.warn(
            `[gh-provisioner] ${entity.k8sId} token lacks scope to check ${section} secret '${secretName}' on org '${entity.cr.spec.org}' — skipping adoption gracefully`,
          );
        } else {
          log.warn(
            `[gh-provisioner] ${entity.k8sId} unexpected error checking ${section} secret '${secretName}' on org '${entity.cr.spec.org}': ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }
  }
}
