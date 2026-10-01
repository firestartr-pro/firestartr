import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

export interface Artifact {
  [key: string]: any;
}

const UUID_ANNOTATION = 'fire-starter.dev/uuid';

/*
 *
 * Aggregates the uuid annotation for firestartr
 *
 */
export function annotateWithUUID(artifact: Artifact): Artifact {
  const uuid: string = uuidv4();

  artifact['metadata']['annotations'][UUID_ANNOTATION] = uuid;

  return artifact;
}

export function helperlGetArtifactUUID(artifact: Artifact): string {
  return artifact['metadata']['annotations'][UUID_ANNOTATION];
}

/*
 *
 * Depending ot the storage type it generates a different key
 *
 */
export function calculateStoregeKey(artifact: Artifact, storageType: string) {
  if (storageType === 's3') {
    return `${artifact['kind'].toLowerCase()}/${helperlGetArtifactUUID(artifact)}`;
  } else {
    return `${artifact['kind'].toLowerCase()}-${helperlGetArtifactUUID(artifact)}`;
  }
}

/*
 * String to md5
 */
export function toMd5(text: string): string {
  return crypto.createHash('md5').update(text).digest('hex');
}
