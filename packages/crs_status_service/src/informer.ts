import { KubeConfig, CustomObjectsApi, Watch } from '@kubernetes/client-node';
import type { StatusProjection, Condition } from './types';
import type { StatusCache } from './cache';
import type { ServiceConfig } from './config';
import { derivePhase } from './phase';
import log from './logger';

function extractClaimRef(item: any): {
  claimKind: string | null;
  claimName: string | null;
} {
  const annotations = item?.metadata?.annotations || {};
  const claimRef = annotations['firestartr.dev/claim-ref'];
  if (!claimRef) return { claimKind: null, claimName: null };
  const parts = claimRef.split('/');
  if (parts.length !== 2) return { claimKind: null, claimName: null };
  return { claimKind: parts[0], claimName: parts[1] };
}

function extractConditions(item: any): Condition[] {
  const raw: any[] = item?.status?.conditions || [];
  return raw.map((c: any) => ({
    type: c.type || '',
    status: c.status || '',
    reason: c.reason || '',
    message: c.message || '',
    lastTransitionTime: c.lastTransitionTime || '',
  }));
}

function buildProjection(item: any, namespace: string): StatusProjection {
  const { claimKind, claimName } = extractClaimRef(item);
  const conditions = extractConditions(item);
  return {
    kind: item.kind || '',
    name: item.metadata?.name || '',
    namespace,
    claimKind,
    claimName,
    phase: derivePhase(conditions),
    conditions,
    observedAt: new Date().toISOString(),
  };
}

function pluralToKind(plural: string): string {
  const map: Record<string, string> = {
    terraformworkspaces: 'FirestartrTerraformWorkspace',
    githubgroups: 'FirestartrGithubGroup',
    githubrepositories: 'FirestartrGithubRepository',
    githubrepositorysecretssections: 'FirestartrGithubRepositorySecretsSection',
    githubrepositoryfeatures: 'FirestartrGithubRepositoryFeature',
    githubmemberships: 'FirestartrGithubMembership',
    githuborgwebhooks: 'FirestartrGithubOrgWebhook',
    githuborganizationsettings: 'FirestartrGithubOrganizationSettings',
  };
  return map[plural] || plural;
}

export class KindInformer {
  private kc: KubeConfig;
  private api: CustomObjectsApi;
  private watch: Watch;
  private watchRequest: any = null;
  private shouldReconnect = true;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private resourceVersion: string | undefined;

  constructor(
    private config: ServiceConfig,
    private plural: string,
    private cache: StatusCache,
  ) {
    this.kc = new KubeConfig();
    this.kc.loadFromDefault();
    this.api = this.kc.makeApiClient(CustomObjectsApi);
    this.watch = new Watch(this.kc);
  }

  private watchPath(): string {
    return `/apis/${this.config.apiGroup}/${this.config.apiVersion}/namespaces/${this.config.namespace}/${this.plural}`;
  }

  async start(): Promise<void> {
    await this.listExisting();
    this.startWatch();
  }

  stop(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.watchRequest && typeof this.watchRequest.abort === 'function') {
      this.watchRequest.abort();
    }
  }

  private async listExisting(): Promise<void> {
    try {
      const response = await this.api.listNamespacedCustomObject({
        group: this.config.apiGroup,
        version: this.config.apiVersion,
        namespace: this.config.namespace,
        plural: this.plural,
      });
      const body = response.body as any;
      this.resourceVersion = body?.metadata?.resourceVersion;
      const items: any[] = body?.items || [];
      const kind = pluralToKind(this.plural);
      for (const item of items) {
        const projection = buildProjection(item, this.config.namespace);
        if (!projection.kind) {
          projection.kind = kind;
        }
        this.cache.upsert(projection.kind, projection.name, projection);
      }
      log.info(`Listed ${items.length} existing CRs for ${this.plural}`);
    } catch (err: any) {
      log.error(
        `Failed to list existing CRs for ${this.plural}: ${err.message}`,
      );
      throw err;
    }
  }

  private startWatch(): void {
    if (!this.shouldReconnect) return;

    const path = this.watchPath();
    log.info(`Starting watch for ${this.plural} at ${path}`);

    const queryParams: Record<string, string> = {};
    if (this.resourceVersion) {
      queryParams.resourceVersion = this.resourceVersion;
    }

    this.watch
      .watch(
        path,
        queryParams,
        (phase: string, obj: any) => {
          this.handleEvent(phase, obj);
        },
        (err: any) => {
          if (err) {
            log.error(`Watch error for ${this.plural}: ${err.message || err}`);
          } else {
            log.info(`Watch for ${this.plural} ended`);
          }
          this.scheduleReconnect();
        },
      )
      .then((req: any) => {
        this.watchRequest = req;
      })
      .catch((err: any) => {
        log.error(
          `Failed to start watch for ${this.plural}: ${err.message || err}`,
        );
        this.scheduleReconnect();
      });
  }

  private handleEvent(phase: string, obj: any): void {
    if (!obj?.metadata?.name) return;
    const kind = obj.kind || pluralToKind(this.plural);
    const name = obj.metadata.name;

    switch (phase) {
      case 'ADDED':
      case 'MODIFIED': {
        const projection = buildProjection(obj, this.config.namespace);
        projection.kind = kind;
        this.cache.upsert(kind, name, projection);
        log.info(`Cache ${phase}: ${kind}/${name} -> ${projection.phase}`);
        break;
      }
      case 'DELETED': {
        this.cache.delete(kind, name, this.config.tombstoneTtlMs);
        log.info(`Cache DELETED: ${kind}/${name} (tombstone set)`);
        break;
      }
      default:
        break;
    }
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect) return;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const delay = 5000;
    log.info(`Reconnecting watch for ${this.plural} in ${delay}ms`);
    this.reconnectTimer = setTimeout(() => {
      void this.listExisting()
        .then(() => this.startWatch())
        .catch((err: any) => {
          log.error(
            `Reconnect list failed for ${this.plural}: ${err?.message || err}`,
          );
          this.scheduleReconnect();
        });
    }, delay);
  }
}
