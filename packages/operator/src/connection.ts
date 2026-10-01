import * as client from '@kubernetes/client-node';
import log from './logger';

export async function getConnection() {
  try {
    const kc: client.KubeConfig = new client.KubeConfig();

    kc.loadFromDefault();

    const opts: any = {};

    await kc.applyToHTTPSOptions(opts);

    return { kc, opts };
  } catch (err) {
    log.error(`getConnection: ${err}`);

    throw err;
  }
}
