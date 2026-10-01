import common from 'catalog_common';
import { BaseSecretsChart } from './base';
import { ApiObject, GroupVersionKind } from 'cdk8s';

export class SecretsChart extends BaseSecretsChart {
  template() {
    const externalSecrets = this.externalSecretCharts();
    const pushSecrets = this.pushSecretCharts();

    if (externalSecrets.length > 0) {
      const eS = this.get('externalSecretsResources').pop();

      this.get('externalSecrets').pop();

      return eS;
    }

    if (pushSecrets.length > 0) {
      const pS = this.get('pushSecretsResources').pop();

      this.get('pushSecrets').pop();

      return pS;
    }

    throw new Error('No secrets found in claim');
  }

  instanceApiObject(template: any): ApiObject {
    return new ApiObject(
      this,

      `${template.kind}-${template.metadata.name}`,

      template,
    );
  }

  gvk(): GroupVersionKind {
    return {
      kind: 'ExternalSecret/PushSecret',

      apiVersion: 'external-secrets.io/v1alpha1',
    };
  }

  extraCharts(): {
    claim: { kind: string; name: string };
    chart: ApiObject;
  }[] {
    const externalSecrets: any = this.get('externalSecrets');

    const pushSecrets: any = this.get('pushSecrets');

    const kind = this.get('claim').kind;

    const name = this.get('claim').name;

    const concatenated = []
      .concat(externalSecrets)
      .concat(pushSecrets)
      .filter((el: any) => el !== undefined);

    return concatenated.map((chart: any) => {
      //console.log('CHART-TO-JSON');
      //console.dir(chart, { depth: null });
      const cr: any = chart.toJson();
      return {
        claim: { kind, name: `${name}-${cr.kind}-${cr.metadata.name}` },
        chart: chart,
      };
    });
  }

  externalSecretCharts(): ApiObject[] {
    const externalSecrets: any[] = [];
    const k8sResources: any[] = [];

    const claim = this.get('claim');
    const externalSecretsFromClaim =
      claim?.providers?.external_secrets?.externalSecrets?.secrets;

    if (!externalSecretsFromClaim) {
      return [];
    }

    const templateData: any = {};
    const refsData: any = [];

    for (const secret of claim?.providers?.external_secrets?.externalSecrets
      ?.secrets || []) {
      templateData[secret.secretName] = `{{ .${secret.secretName} }}`;

      refsData.push({
        secretKey: secret.secretName,
        remoteRef: {
          key: secret.remoteRef ? secret.remoteRef : secret.secretName,
        },
      });
    }

    const k8sResource: any = {
      apiVersion: 'external-secrets.io/v1',
      kind: 'ExternalSecret',
      metadata: {
        name: common.generic.normalizeName(claim.name),
        annotations: {
          'firestartr.dev/claim-ref': `${claim.kind}/${claim.name}`,
          'firestartr.dev/external-name': claim.providers.external_secrets.name,
        },
      },
      spec: {
        refreshInterval:
          claim.providers.external_secrets.externalSecrets.refreshInterval ||
          '1y',
        secretStoreRef: {
          name: claim.providers.external_secrets.secretStore.name,
          kind:
            claim.providers.external_secrets.secretStore.kind || 'SecretStore',
        },
        target: {
          name: common.generic.normalizeName(claim.name),
          creationPolicy: 'Owner',
          deletionPolicy: 'Delete',
        },
        data: refsData,
      },
    };

    const cr: ApiObject = new ApiObject(this, `es-${claim.name}`, k8sResource);

    externalSecrets.push(cr);
    k8sResources.push(k8sResource);

    this.set('externalSecretsResources', k8sResources);
    this.set('externalSecrets', externalSecrets);
    return externalSecrets;
  }

  pushSecretCharts(): ApiObject[] {
    const pushSecretsFromClaim =
      this.get('claim').providers.external_secrets.pushSecrets;

    const claim = this.get('claim');

    const pushSecrets: ApiObject[] = [];
    const k8sResources: any[] = [];

    if (!pushSecretsFromClaim) {
      return [];
    }

    for (const pushSecret of pushSecretsFromClaim) {
      const k8sResource: any = {
        apiVersion: 'external-secrets.io/v1alpha1',
        kind: 'PushSecret',
        metadata: {
          name: common.generic.normalizeName(
            `${pushSecret.secretName}-${claim.name}`,
          ),
          annotations: {
            'firestartr.dev/claim-ref': `${claim.kind}/${claim.name}`,
            'firestartr.dev/external-name':
              claim.providers.external_secrets.name,
          },
        },
        spec: {
          updatePolicy: pushSecret.updatePolicy || 'Replace',
          deletionPolicy: pushSecret.deletionPolicy || 'None',
          refreshInterval: pushSecret.refreshInterval || '5m',
          secretStoreRefs: [
            {
              kind:
                claim.providers.external_secrets.secretStore.kind ||
                'SecretStore',
              name: claim.providers.external_secrets.secretStore.name,
            },
          ],
          selector: {
            generatorRef: {
              apiVersion:
                pushSecret.generator?.apiVersion ||
                'generators.external-secrets.io/v1',
              kind: pushSecret.generator?.kind || 'Password',
              name: pushSecret.generator.name,
            },
          },
          data: [
            {
              conversionStrategy: pushSecret.conversionStrategy || 'None',
              match: {
                remoteRef: {
                  remoteKey: pushSecret.secretName,
                },
                secretKey: pushSecret.generator?.outputKey || 'password',
              },
            },
          ],
        },
      };

      const cr: ApiObject = new ApiObject(
        this,
        `ps-${pushSecret.secretName}-${claim.name}`,
        k8sResource,
      );

      k8sResources.push(k8sResource);

      pushSecrets.push(cr);
    }

    this.set('pushSecretsResources', k8sResources);
    this.set('pushSecrets', pushSecrets);

    return pushSecrets;
  }
}
