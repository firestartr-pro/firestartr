export const SCHEMA_CONTRACTS = [
  'CommandHelpJson',
  'RelationGraph',
  'MutationDiff',
] as const;

export type SchemaContractName = (typeof SCHEMA_CONTRACTS)[number];

export function isSchemaContractName(
  value: string,
): value is SchemaContractName {
  return (SCHEMA_CONTRACTS as readonly string[]).includes(value);
}
