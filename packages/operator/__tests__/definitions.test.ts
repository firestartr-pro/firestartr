import {
  getKindFromPlural,
  getPluralFromKind,
  OperationType,
  retryOpForReason,
} from '../src/definitions';

describe('definitions', () => {
  it('maps GitHub organization settings kind and plural', () => {
    expect(getKindFromPlural('githuborganizationsettings')).toBe(
      'FirestartrGithubOrganizationSettings',
    );
    expect(getPluralFromKind('FirestartrGithubOrganizationSettings')).toBe(
      'githuborganizationsettings',
    );
  });
});

describe('retryOpForReason', () => {
  it('returns RETRY when reason is undefined', () => {
    expect(retryOpForReason(undefined)).toBe(OperationType.RETRY);
  });

  it('returns RETRY_SYNC when reason is SYNC', () => {
    expect(retryOpForReason('SYNC')).toBe(OperationType.RETRY_SYNC);
  });

  it('returns RETRY_SYNC when reason is RETRY_SYNC', () => {
    expect(retryOpForReason('RETRY_SYNC')).toBe(OperationType.RETRY_SYNC);
  });

  it('returns RETRY for unrecognised reasons', () => {
    expect(retryOpForReason('APPLY_ERROR')).toBe(OperationType.RETRY);
  });

  it('returns RETRY for empty string reason', () => {
    expect(retryOpForReason('')).toBe(OperationType.RETRY);
  });

  it('strips RETRY_ prefix before matching', () => {
    expect(retryOpForReason('RETRY_SYNC')).toBe(OperationType.RETRY_SYNC);
  });
});
