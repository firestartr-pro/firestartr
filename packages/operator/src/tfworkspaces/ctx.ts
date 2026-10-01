import { runTerraformProvisioner } from 'terraform_provisioner';
import {
  createDryRun,
  getItemByItemPath,
  getSecret,
  updateDryRun,
} from '../ctl';
import { Ctx } from '../ctx';
import { resolve } from '../resolver';
import { buildProvisionerContext } from './process-operation';
import cdk8s_renderer from 'cdk8s_renderer';
import { getCRfromClaimRef, getTFWorkspaceRefs } from './ctl';

import log from '../logger';

export async function buildContext(
  claim: any,
  namespace: string,
  command: 'plan' | 'apply',
) {
  const compute: { [key: string]: Function } = {};

  let previousCR: any = null;

  let cr: any = null;

  let deps: any = null;

  compute['resolveDeps'] = async () => {
    log.debug(
      `The Terraform workspace is resolving dependencies for the claim '${claim.name}'.`,
    );

    // First, we bring the previous CR, if any, to get the tfStateKey
    log.debug(
      `The Terraform workspace is resolving and getting the previous custom resource for claim '${claim.name}'.`,
    );

    previousCR = await getCRfromClaimRef(
      claim.kind,

      claim.name,

      namespace,
    );

    let tfStateKey = null;

    if (previousCR) {
      log.debug(
        `The Terraform workspace found a previous custom resource for claim '${claim.name}'.`,
      );
      tfStateKey = previousCR.spec.firestartr.tfStateKey;
    } else
      log.debug(
        `The Terraform workspace did not find a previous custom resource for claim '${claim.name}'.`,
      );
    // Then we render the claim passing a function to resolve the refs in the k8s API
    log.debug(
      `The Terraform workspace is starting the rendering process for claim '${claim.name}'.`,
    );

    cr = await cdk8s_renderer.renderTfWorkspace(
      claim,

      tfStateKey,

      getTFWorkspaceRefs,

      namespace,
    );

    cr['metadata']['namespace'] = namespace;

    log.debug(
      `The Terraform workspace has finished rendering the custom resource '${cr.kind}/${cr.metadata.name}' in namespace '${cr.metadata.namespace}'.`,
    );
    // Finally, we resolve the deps in the rendered CR
    deps = await resolve(
      cr,

      getItemByItemPath,

      getSecret,

      namespace,
    );

    log.debug(
      `The Terraform workspace has finished resolving all dependencies for claim '${claim.name}'.`,
    );
  };

  compute['dryRunExec'] = async () => {
    // We assume that if there is no previous CR, we are creating a new one
    // This will be preceeded by the resolveDeps function
    log.debug(
      `The Terraform workspace is dry-running the validation for custom resource '${cr.kind}/${cr.metadata.name}' in namespace '${cr.metadata.namespace}'.`,
    );
    if (!previousCR) {
      await createDryRun(cr, namespace);
    } else {
      cr.metadata.resourceVersion = previousCR.metadata.resourceVersion;

      await updateDryRun(cr, namespace);
    }

    log.debug(
      `The Terraform workspace has finished validating the custom resource '${cr.kind}/${cr.metadata.name}' in namespace '${cr.metadata.namespace}'.`,
    );
  };

  compute['runProvision'] = async () => {
    log.debug('TFWORKSPACE_RUN_PROVISION_INIT_TERRAFORM', {
      metadata: { cr, command },
    });

    const data = await buildProvisionerContext(cr, deps);

    const result: any = await runTerraformProvisioner(data, command);

    log.debug(
      `The Terraform workspace has finished the '${command}' command for provisioning custom resource '${cr.kind}/${cr.metadata.name}' in namespace '${cr.metadata.namespace}'.`,
    );

    return result;
  };

  return new Ctx({}, compute);
}
