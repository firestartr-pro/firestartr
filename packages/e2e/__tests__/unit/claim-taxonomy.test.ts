import {
  FIRESTARTR_ANNOTATIONS,
  getFirestartrAnnotation,
  getRelatedCrKindsForClaimKind,
} from '../../src/claim-taxonomy';

describe('Firestartr annotation vocabulary', () => {
  it('names every Firestartr annotation from one constant', () => {
    expect(FIRESTARTR_ANNOTATIONS).toEqual({
      claimRef: 'claim-ref',
      reconcileAt: 'reconcile-at',
      import: 'import',
      externalName: 'external-name',
    });

    expect(getFirestartrAnnotation('claimRef')).toBe(
      'firestartr.dev/claim-ref',
    );
    expect(getFirestartrAnnotation('reconcileAt')).toBe(
      'firestartr.dev/reconcile-at',
    );
    expect(getFirestartrAnnotation('import')).toBe('firestartr.dev/import');
    expect(getFirestartrAnnotation('externalName')).toBe(
      'firestartr.dev/external-name',
    );
  });
});

describe('getRelatedCrKindsForClaimKind', () => {
  it('returns the user CR kind for user claims', () => {
    expect(getRelatedCrKindsForClaimKind('UserClaim')).toEqual([
      'FirestartrGithubMembership',
    ]);
  });

  it('returns the org webhook CR kind for org webhook claims', () => {
    expect(getRelatedCrKindsForClaimKind('OrgWebhookClaim')).toEqual([
      'FirestartrGithubOrgWebhook',
    ]);
  });

  it('returns the terraform workspace CR kind for tfworkspace claims', () => {
    expect(getRelatedCrKindsForClaimKind('TFWorkspaceClaim')).toEqual([
      'FirestartrTerraformWorkspace',
    ]);
  });
});
