import * as client from '@kubernetes/client-node';
import * as fs from 'fs';
import * as stream from 'stream';

import common from 'catalog_common';
import { execSync } from 'child_process';
import { getConnection } from '../ctl';

import util from 'util';

const deploymentName =
  common.environment.getFromEnvironment(
    common.types.envVars.operatorDeploymentName,
  ) || 'firestartr-firestartr-controller';

const DEFAULT_OPERATOR_DEPLOY = deploymentName;

export function withToolImageTag(
  image: string | undefined,
  toolImageTag?: string,
) {
  if (!image || !toolImageTag) return image;

  const digestIndex = image.indexOf('@');
  const imageWithoutDigest =
    digestIndex >= 0 ? image.slice(0, digestIndex) : image;
  const digestSuffix = digestIndex >= 0 ? image.slice(digestIndex) : '';
  const lastSlashIndex = imageWithoutDigest.lastIndexOf('/');
  const lastColonIndex = imageWithoutDigest.lastIndexOf(':');

  if (lastColonIndex > lastSlashIndex) {
    return `${imageWithoutDigest.slice(0, lastColonIndex)}:${toolImageTag}${digestSuffix}`;
  }

  return `${imageWithoutDigest}:${toolImageTag}${digestSuffix}`;
}

export async function tfPlanner(
  claimFilePath: string,
  claim: any,
  namespace: string,
  debug: boolean,
  jobTtl = 300,
  cmd = 'plan',
  toolImageTag?: string,
  callbackApi = function (ctl: any) {},
) {
  const { kc } = await getConnection();

  const k8sApi = kc.makeApiClient(client.AppsV1Api);

  const batchV1Api = kc.makeApiClient(client.BatchV1Api);

  const targetNamespaceName = namespace;

  const targetDeploymentName = DEFAULT_OPERATOR_DEPLOY;

  const controllerDeploy = await k8sApi.readNamespacedDeployment({
    name: targetDeploymentName,

    namespace: targetNamespaceName,
  });

  // we create the job
  const job = new client.V1Job();
  job.apiVersion = 'batch/v1';
  job.kind = 'Job';

  const metadata = new client.V1ObjectMeta();

  metadata.name = `tf-planner-${common.generic.normalizeName(claim.name).substring(0, 38)}-${Date.now()}`;

  metadata.annotations = {
    'cronjob.kubernetes.io/instantiate': 'manual',
  };

  const executablePath = process.env.IS_DEV_ENVIRONMENT
    ? '/library/scripts/run.sh'
    : '/library/run.sh';

  job.spec = new client.V1JobSpec();

  job.spec.ttlSecondsAfterFinished = jobTtl;

  job.spec.template = controllerDeploy.spec.template;

  job.spec.template.spec.containers[0].image = withToolImageTag(
    job.spec.template.spec.containers[0].image,
    toolImageTag,
  );

  if (!debug) {
    // set activeDeadlineSeconds to force terminate jobs that exceed this time
    // see https://kubernetes.io/docs/concepts/workloads/controllers/job/#job-termination-and-cleanup
    job.spec.activeDeadlineSeconds = 3600;
  }

  job.spec.template.spec.containers[0].env = [{ name: 'CI', value: 'True' }];

  if (debug) {
    job.spec.template.spec.containers[0].env.push({
      name: 'FIRESTARTR_DEBUG',
      value: 'true',
    });
  }

  job.spec.template.spec.containers[0].command = [
    'sh',
    '-c',
    `${executablePath} operator --${cmd} --claim /tmp/claim.yaml --namespace ${namespace}`,
  ];

  if (debug) {
    job.spec.template.spec.containers[0].command[2] =
      job.spec.template.spec.containers[0].command[2].concat(
        ' ; tail -f /dev/null',
      );
  }

  job.spec.template.spec.restartPolicy = 'Never';

  job.metadata = metadata;

  // we limit the number of retries
  // to 1
  job.spec.backoffLimit = 1;

  // we exclude logs to be sent to datadog
  job.spec.template.metadata.annotations = {
    'ad.datadoghq.com/logs_exclude': 'true',
  };

  callbackApi({
    ctlCleanUp: () => cleanUp(namespace, metadata.name),
  });

  await batchV1Api.createNamespacedJob({ namespace, body: job });

  await copyClaimAndGetLogs(namespace, job.metadata.name, claimFilePath, debug);
}

async function cleanUp(namespace: string, jobName: string) {
  try {
    console.log('Cleaning up the job');

    const { kc } = await getConnection();

    const batchV1Api = kc.makeApiClient(client.BatchV1Api);

    console.log('Deleting job and its associated pods');

    await batchV1Api.deleteNamespacedJob({
      name: jobName,
      namespace,
      gracePeriodSeconds: 0,
      propagationPolicy: 'Foreground',
    });
  } catch (err) {
    const cleanError = util.inspect(err, {
      showHidden: false,
      depth: 1,
      colors: false,
    });
    console.error(cleanError);
  }
}

async function copyClaimAndGetLogs(
  namespace: string,
  jobName: string,
  sourcePath: string,
  skipLogs = false,
) {
  const { kc } = await getConnection();

  const k8sApi = kc.makeApiClient(client.CoreV1Api);

  const logStream = new stream.PassThrough();

  const delay = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  async function getPod(): Promise<client.V1Pod> {
    const resPods = await k8sApi.listNamespacedPod({
      namespace,
      labelSelector: `job-name=${jobName}`,
    });

    const [pod] = resPods.items;

    return pod;
  }

  logStream.on(
    'data',

    (chunk) => {
      process.stdout.write(chunk);

      const logMessage = chunk.toString();
    },
  );

  let pod: client.V1Pod = {};

  async function awaitPodStatus(fTest: Function) {
    while (1) {
      pod = await getPod();

      if (pod && pod.status && fTest(pod.status.phase)) {
        break;
      } else {
        await delay(1000);
      }
    }
  }

  console.log('Waiting for pod to be running');

  await awaitPodStatus((phase: string) => phase !== 'Pending');

  console.log('Pod is running');

  const { size } = fs.statSync(sourcePath);

  console.log('Creating control file size path');

  fs.writeFileSync(
    sourcePath + '.size',

    size.toString(),

    {
      encoding: 'utf8',
    },
  );

  await kubectlCp(
    sourcePath + '.size',

    namespace,

    pod.metadata.name,

    '/tmp/claim.yaml.size',
  );

  console.log('Control file size path created');

  console.log('Copying claim to pod');

  await kubectlCp(
    sourcePath,

    namespace,

    pod.metadata.name,
  );

  console.log('Claim copied to pod');

  if (skipLogs) {
    console.log('Debug mode: skipping log streaming');
    return;
  }

  try {
    const logClient = new client.Log(kc);
    await new Promise<void>((resolve, reject) => {
      logStream.once('finish', resolve);
      logStream.once('error', reject);
      logClient
        .log(
          namespace,
          pod.metadata.name,
          pod.spec.containers[0].name,
          logStream,
          {
            follow: true,
            tailLines: 50,
            timestamps: false,
          },
        )
        .catch(reject);
    });
  } catch (err) {
    const cleanError = util.inspect(err, {
      showHidden: false,
      depth: 1,
      colors: false,
    });
    console.error(cleanError);
    return;
  }
}

export function kubectlCp(
  sourcePath: string,

  namespace: string,

  podName: string,

  podFilePath = '/tmp/claim.yaml',
) {
  const command = `kubectl cp -n ${namespace} ${sourcePath} ${podName}:${podFilePath}`;

  execSync(command);
}
