export type { CollectionFilter } from './filters';

export function applyCollectionMixins(derivedCtor: any) {
  const constructors = [CollectionMixins];

  constructors.forEach((baseCtor) => {
    Object.getOwnPropertyNames(baseCtor.prototype).forEach((name) => {
      Object.defineProperty(
        derivedCtor.prototype,

        name,

        Object.getOwnPropertyDescriptor(baseCtor.prototype, name) ||
          Object.create(null),
      );
    });
  });
}

export class CollectionMixins {
  IS_FILTER_BY_NAME_SET(filters: any[], kind: string) {
    return filters.some(
      (filter: any) => filter.type === 'NAME' && filter.kind === kind,
    );
  }

  IS_SKIP_SET(filters: any[], kind: string) {
    return filters.some(
      (filter: any) => filter.type === 'SKIP' && filter.kind === kind,
    );
  }

  IS_FILTER_BY_REGEXP_SET(filters: any[], kind: string) {
    return filters.some(
      (filter: any) => filter.type === 'REGEXP' && filter.kind === kind,
    );
  }

  IS_FILTER_BY_FUNCTION_SET(filters: any[], kind: string) {
    return filters.some(
      (filter: any) => filter.type === 'FUNCTION' && filter.kind === kind,
    );
  }

  FILTER_BY_NAME_APPLY(filters: any[], kind: string, fn: Function) {
    const filtersByName = filters.filter(
      (f: any) => f.type === 'NAME' && f.kind === kind,
    );

    return fn(filtersByName.map((f: any) => f.name));
  }

  FILTER_BY_REGEXP_APPLY(filters: any[], kind: string, fn: Function) {
    const filter = filters.filter(
      (f: any) => f.type === 'REGEXP' && f.kind === kind,
    )[0];

    return fn(filter.regexp);
  }

  FILTER_BY_FUNCTION_APPLY(filters: any[], kind: string, fn: Function) {
    const filter = filters.filter(
      (f: any) => f.type === 'FUNCTION' && f.kind === kind,
    )[0];

    return fn(filter.fn);
  }

  async filter(
    kind: string,

    filters: any[],

    elementList: any[],
  ) {
    if (filters.length === 0) return elementList;

    if (this.IS_FILTER_BY_NAME_SET(filters, kind)) {
      return this.FILTER_BY_NAME_APPLY(
        filters,

        kind,

        (names: string[]) => {
          const result = elementList.filter(
            (el: string) => names.indexOf(el) !== -1,
          );

          return result;
        },
      );
    }

    if (this.IS_FILTER_BY_REGEXP_SET(filters, kind)) {
      return this.FILTER_BY_REGEXP_APPLY(
        filters,

        kind,

        (nameRegExp: RegExp) => {
          return elementList.filter((el: string) => nameRegExp.test(el));
        },
      );
    }

    if (this.IS_FILTER_BY_FUNCTION_SET(filters, kind)) {
      await this.FILTER_BY_FUNCTION_APPLY(
        filters,

        kind,

        async (fn: Function) => {
          elementList = (
            await Promise.all(
              elementList.map(async (el: string) => {
                return (await fn(kind, el)) ? el : undefined;
              }),
            )
          ).filter((el: any) => el !== undefined);
        },
      );
    }

    return elementList;
  }
}

export interface ICollection extends CollectionMixins {}
