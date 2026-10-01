export interface Workspace {
  kind: string;
  name: string;
  owner: string;
  annotations?: { [key: string]: string };
  system?: string;
  lifecycle?: string;
  type?: string;
  version: string;
}

export const schema = 'firestartr.dev://common/TFWorkspaceClaim';
