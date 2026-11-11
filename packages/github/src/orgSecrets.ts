import { getOctokitForOrg } from './auth';
import sodium from 'libsodium-wrappers';

import log from './logger';

export type OrgSecretsSection = 'actions' | 'dependabot' | 'codespaces';

export async function getOrgPublicKey(
  org: string,
  section: OrgSecretsSection,
  octokit?: any,
) {
  log.info(`Retrieving org public key for ${org} (${section})`);

  try {
    if (!octokit) {
      octokit = await getOctokitForOrg(org);
    }
    const { data } = await octokit.rest[`${section}`].getOrgPublicKey({
      org,
    });
    return data;
  } catch (error) {
    log.error(
      `Error retrieving org public key (${section}) for ${org}: ${error}`,
    );
    throw error;
  }
}

export async function encryptOrgSecret(
  org: string,
  section: OrgSecretsSection,
  plaintextValue: string,
  preFetchedKey?: { key_id: string; key: string },
  octokit?: any,
) {
  try {
    const { key_id, key } = preFetchedKey
      ? preFetchedKey
      : await getOrgPublicKey(org, section, octokit);

    await sodium.ready;

    const publicKey = sodium.from_base64(key, sodium.base64_variants.ORIGINAL);
    const secretBytes = sodium.from_string(plaintextValue);

    const encryptedBytes = sodium.crypto_box_seal(secretBytes, publicKey);

    const encryptedValue = sodium.to_base64(
      encryptedBytes,
      sodium.base64_variants.ORIGINAL,
    );

    return {
      key_id,
      encrypted_value: encryptedValue,
    };
  } catch (err) {
    log.error(`Error encrypting org secret (${section}) for ${org}: ${err}`);

    throw err;
  }
}

export async function getOrgSecret(
  org: string,
  section: OrgSecretsSection,
  name: string,
  octokit?: any,
) {
  log.info(`Checking org secret ${name} (${section}) for ${org}`);

  try {
    if (!octokit) {
      octokit = await getOctokitForOrg(org);
    }
    const response = await octokit.rest[`${section}`].getOrgSecret({
      org,
      secret_name: name,
    });
    return response.data;
  } catch (err: any) {
    if (err && err.status === 404) {
      return null;
    }
    throw err;
  }
}
