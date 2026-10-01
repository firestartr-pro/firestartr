enum CollectionFilterTypes {
  NAME = 'NAME',

  REGEXP = 'REGEXP',

  FUNCTION = 'FUNCTION',

  SKIP = 'SKIP',
}
type CollectionFilterType = keyof typeof CollectionFilterTypes;

export type CollectionFilter = {
  type: 'NAME' | 'REGEXP' | 'FUNCTION' | 'SKIP';

  kind: string;

  regexp?: RegExp;

  name?: string;

  fn?: Function;
};

// gh-groups,NAME=foo
// gh-repo,REGEXP=foo*
// gh-members,FUNCTION=fName
// gh-repo,SKIP=SKIP
const FILTER_REG = new RegExp(/([-\w]+),(\w+)=(.+)/);

export function filtersBuilder(
  args: string[],
  functions: any,
): CollectionFilter[] {
  return args.map((arg: string): CollectionFilter => {
    if (!FILTER_REG.test(arg)) {
      throw `Filters builder: "${arg}" is not a filter or incorrect format`;
    } else {
      const [_, kind, type, value] = FILTER_REG.exec(arg) || ['', '', ''];

      return {
        type: type as CollectionFilterType,

        kind,

        name: type === 'NAME' ? value : '',

        regexp: type === 'REGEXP' ? compileReg(value) : new RegExp(/.+/),

        fn: type === 'FUNCTION' ? functions[value] : function () {},
      };
    }
  });
}

function compileReg(value: string) {
  return new RegExp(value);
}
