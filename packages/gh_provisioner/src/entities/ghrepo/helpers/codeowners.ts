import { Entity, PatchOperations } from '../../base';
import log from '../../../logger';
import { EntityGHRepo } from '../';

// Helper: Escape RegExp special characters in owner strings
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function provisionCodeowners(fsGithubRepository: EntityGHRepo) {
  const cr = fsGithubRepository.cr;
  let codeownersText = cr.spec.repo.codeowners;
  const org = cr.spec.org;

  if (typeof codeownersText !== 'string') {
    log.debug(
      '[provisionCodeowners] No CODEOWNERS content configured; skipping provisioning.',
    );
    return;
  }

  // 1. Gather all group refs present in cr.spec.permissions (if any)
  const allRefs: any[] = [];
  if (cr.spec.permissions && Array.isArray(cr.spec.permissions)) {
    for (const perm of cr.spec.permissions) {
      if (perm.ref && perm.ref.kind === 'FirestartrGithubGroup') {
        allRefs.push(perm.ref);
      }
    }
  }
  // (Extend here if group refs appear in other fields in future specs)

  // 2. For each group dependency: get external name & slug
  const replacements: Array<{ from: string; to: string }> = [];
  for (const ref of allRefs) {
    let dep;
    try {
      dep = Entity.refResolver(ref);
    } catch (e) {
      log.error(
        `[provisionCodeowners] Failed to resolve group ref ${ref.name}: ${String(e)}`,
      );
      continue;
    }
    const extName =
      dep?.cr?.metadata?.annotations?.['firestartr.dev/external-name'];
    const slug = dep?.getOutput && dep.getOutput('slug');

    if (!extName) {
      log.error(
        `[provisionCodeowners] Missing external-name annotation for group ref ${ref.name}`,
      );
      continue;
    }
    if (!slug) {
      log.error(
        `[provisionCodeowners] Missing slug output for group '${extName}' (${ref.name}) - will preserve as-is.`,
      );
      continue;
    }
    const from = `@${org}/${extName}`;
    const to = `@${org}/${slug}`;
    replacements.push({ from, to });
  }

  // 3. Replace all exact occurrences of each external name owner with slug owner
  for (const { from, to } of replacements) {
    // Needs literal match, even if source owner has spaces/punctuation
    codeownersText = codeownersText.replace(
      new RegExp(escapeRegExp(from), 'g'),
      to,
    );
  }

  // Do not reformat, parse, or canonicalize further (per spec: preserve layout except for replacements)

  const config = {
    branch: cr.spec.repo.defaultBranch,
    commitMessage: 'ci: provision CODEOWNERS file',
    content: codeownersText,
    file: '.github/CODEOWNERS',
    overwriteOnCreate: true,
  };

  log.debug(
    `[provisionCodeowners] Final CODEOWNERS content: ${codeownersText}`,
  );

  fsGithubRepository.patchData({
    path: '/config/files/-',
    op: PatchOperations.add,
    value: config,
  });
}
