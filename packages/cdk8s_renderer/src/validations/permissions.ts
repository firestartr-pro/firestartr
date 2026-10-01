import { RenderedCrMap } from '../renderer/types';
import log from '../logger';

export function validatePermissionsUniqueness(crs: RenderedCrMap): void {
  for (const crkey in crs) {
    const cr: any = crs[crkey];

    if (cr.kind === 'FirestartrGithubRepository') {
      const permissions = cr.spec.permissions;

      log.debug(`Validating Permissions Uniqueness of ${crkey}`);

      if (permissions) {
        const rolesByIdentifier = new Map<string, string>();

        for (const perm of permissions) {
          const identifier = perm.collaborator
            ? perm.collaborator
            : `ref:${perm.ref.kind}:${perm.ref.name}`;

          const role = perm.role;
          const prevRole = rolesByIdentifier.get(identifier);

          if (prevRole === undefined) {
            rolesByIdentifier.set(identifier, role);
          } else if (prevRole !== role) {
            throw new Error(
              `Conflicting permission role in FirestartrGithubRepository ${crkey}: ${identifier} has roles "${prevRole}" and "${role}".\nFull CR: ${JSON.stringify(cr, null, 2)}`,
            );
          }
        }
      }
    }
  }
}
