import { Flags } from '@oclif/core';

import type { FlagInput } from '@oclif/core/interfaces';
import type { FlagSpec } from './deriveFlags.js';

const REPEATABLE_FLAG_SUFFIX =
  '(repeating this flag replaces the whole array; values are not appended)';

export function runtimeFlags(
  specs: FlagSpec[],
  applyDefaults = true,
): FlagInput {
  return Object.fromEntries(
    specs.map((spec) => {
      const conditionalDescription = spec.conditionalRequired
        ? `${spec.description ?? spec.path} (required when its parent is supplied)`
        : spec.description;
      const description = spec.multiple
        ? `${conditionalDescription ?? spec.path} ${REPEATABLE_FLAG_SUFFIX}`
        : conditionalDescription;
      if (spec.type === 'boolean') {
        return [
          spec.path,
          Flags.boolean({
            description,
            allowNo: true,
            required: spec.required,
            default:
              applyDefaults &&
              !spec.conditionalDefault &&
              typeof spec.defaultValue === 'boolean'
                ? spec.defaultValue
                : undefined,
          }),
        ];
      }

      if (spec.type === 'number') {
        const defaultValue =
          applyDefaults &&
          !spec.conditionalDefault &&
          typeof spec.defaultValue === 'number'
            ? spec.defaultValue
            : undefined;
        const defaultValues =
          applyDefaults &&
          !spec.conditionalDefault &&
          Array.isArray(spec.defaultValue) &&
          spec.defaultValue.every((value) => typeof value === 'number')
            ? spec.defaultValue
            : undefined;
        if (spec.integer) {
          return [
            spec.path,
            spec.multiple
              ? Flags.integer({
                  description,
                  required: spec.required,
                  multiple: true,
                  default: defaultValues,
                })
              : Flags.integer({
                  description,
                  required: spec.required,
                  default: defaultValue,
                }),
          ];
        }
        const parse = async (input: string): Promise<number> => {
          const value = Number(input);
          if (input.trim() === '' || !Number.isFinite(value)) {
            throw new Error('Expected a number');
          }
          return value;
        };
        const numberFlag = Flags.custom<number>({ parse });
        return [
          spec.path,
          spec.multiple
            ? numberFlag({
                description,
                required: spec.required,
                multiple: true,
                default: defaultValues,
              })
            : numberFlag({
                description,
                required: spec.required,
                default: defaultValue,
              }),
        ];
      }

      const defaultValue =
        applyDefaults &&
        !spec.conditionalDefault &&
        typeof spec.defaultValue === 'string'
          ? spec.defaultValue
          : undefined;
      const defaultValues =
        applyDefaults &&
        !spec.conditionalDefault &&
        Array.isArray(spec.defaultValue) &&
        spec.defaultValue.every((value) => typeof value === 'string')
          ? spec.defaultValue
          : undefined;
      return [
        spec.path,
        spec.multiple
          ? Flags.string({
              description,
              required: spec.required,
              options: spec.enumValues,
              multiple: true,
              default: defaultValues,
            })
          : Flags.string({
              description,
              required: spec.required,
              options: spec.enumValues,
              default: defaultValue,
            }),
      ];
    }),
  );
}
