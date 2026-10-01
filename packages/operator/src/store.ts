import ffast from 'fast-json-patch';

import log from './logger';

export class Store {
  kind: string;

  store: any = {};

  constructor(kind: string) {
    this.kind = kind;
  }

  add(item: any) {
    log.debug(
      `Added item '${item.metadata.name}' of kind '${this.kind}' to the store in namespace '${item.metadata.namespace}'`,
    );

    this.store[itemPath(this.kind, item)] = {
      item,
    };
  }

  hasDeletionTimestamp(item: any) {
    return 'deletionTimestamp' in item.metadata;
  }

  markToDelete(item: any) {
    log.debug(
      `Marked item '${item.metadata.name}' of kind '${this.kind}' for deletion in namespace '${item.metadata.namespace}'`,
    );

    this.store[itemPath(this.kind, item)] = {
      item,

      markedToDelete: true,
    };
  }

  hasBeenMarkedToDelete(item: any) {
    const oldItem: any = this.getItem(item).item;

    const patches = ffast.compare(item, oldItem);

    let updated = false;

    for (const patch of patches) {
      if (patch.path.match(/^\/metadata\/deletionTimestamp/)) {
        updated = true;

        break;
      }
    }

    return updated;
  }

  modified(item: any) {
    const oldItem: any = this.getItem(item).item;

    const patches = ffast.compare(item, oldItem);

    let updated = false;

    for (const patch of patches) {
      if (
        patch.path.match(/^\/spec/) ||
        patch.path.match(/\/metadata.*annotations\/firestartr\.dev/)
      ) {
        updated = true;

        break;
      }
    }

    this.store[itemPath(this.kind, item)] = {
      item,
    };

    if (updated)
      log.debug(
        `Modified item '${item.metadata.name}' of kind '${this.kind}' in namespace '${item.metadata.namespace}' with patches ${JSON.stringify(patches)}`,
      );

    return updated;
  }

  remove(item: any) {
    log.debug(
      `Removed item '${item.metadata.name}' of kind '${this.kind}' from namespace '${item.metadata.namespace}'`,
    );

    delete this.store[itemPath(this.kind, item)];
  }

  getItem(item: any) {
    return this.store[itemPath(this.kind, item)];
  }
}

export function itemPath(kind: string, item: any) {
  return `${item.metadata.namespace}/${kind}/${item.metadata.name}`;
}
