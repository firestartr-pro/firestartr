import { getOctokitForOrg } from './auth';
import sodium from 'libsodium-wrappers';

import log from './logger';

export type RepoSecretsSection = 'actions' | 'dependabot' | 'codespaces';

export async function getRepoPublicKey(
  owner: string,
  repo: string,
  section: RepoSecretsSection,
  octokit?: any,
) {
  log.info(`Retrieving public key for ${owner}/${repo}`);

  try {
    if (!octokit) {
      octokit = await getOctokitForOrg(owner);
    }
    const { data } = await octokit[section].getRepoPublicKey({
      owner,
      repo,
    });
    return data;
  } catch (error) {
    log.error(
      `Error retrieving public key (${section}) for ${owner}/${repo}: ${error}`,
    );
    throw error;
  }
}

export async function encryptRepoSecret(
  owner: string,
  repo: string,
  section: RepoSecretsSection,
  plaintextValue: string,
  octokit?: any,
) {
  try {
    const { key_id, key } = await getRepoPublicKey(
      owner,
      repo,
      section,
      octokit,
    );

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
    log.error(`Error encrypting secret for ${owner}/${repo}: ${err}`);

    throw err;
  }
}
