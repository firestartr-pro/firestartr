import type { E2EApi } from '../types';
import type { E2EState } from './state';

const stateByClient = new WeakMap<E2EApi, E2EState>();

export function registerE2EState(client: E2EApi, state: E2EState): void {
  stateByClient.set(client, state);
}

export function getE2EState(client: E2EApi): E2EState {
  const state = stateByClient.get(client);
  if (!state) {
    throw new Error('Missing internal E2E state for provided client');
  }

  return state;
}
