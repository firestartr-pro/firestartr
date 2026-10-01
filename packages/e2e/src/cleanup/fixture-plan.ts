import { createNameBuilder } from '../names';
import type { FixtureResourceInput } from './types';

export interface ResolvedFixtureResource {
  fixtureName: string;
  claimName: string;
}

function getFixtureName(input: FixtureResourceInput): string {
  return typeof input === 'string' ? input : input.fixtureName;
}

function getFixtureClaimName(
  nameBuilder: ReturnType<typeof createNameBuilder>,
  input: FixtureResourceInput,
): string {
  if (typeof input === 'string') {
    return nameBuilder.build(input);
  }

  const claimName = input.claimName?.trim();
  if (claimName) {
    return claimName;
  }

  return nameBuilder.build(input.fixtureName);
}

export function resolveFixtureResources(
  prefix: string,
  fixtures: FixtureResourceInput[],
): ResolvedFixtureResource[] {
  const nameBuilder = createNameBuilder(prefix);
  return fixtures.map((fixture) => ({
    fixtureName: getFixtureName(fixture),
    claimName: getFixtureClaimName(nameBuilder, fixture),
  }));
}

export function getDeletionOrder<T>(items: readonly T[]): T[] {
  return [...items].reverse();
}
