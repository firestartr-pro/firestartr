import Ajv from 'ajv/dist/2020';
import schemas from './schemas';

const ajv = new Ajv({ useDefaults: true });

let initiated = false;

const validations: any = {};

function prepareValidation(schemaId: string) {
  if (!initiated) ajv.addSchema(schemas.schemas);

  if (!validations[schemaId]) validations[schemaId] = ajv.getSchema(schemaId);

  initiated = true;

  return validations[schemaId];
}

export function validateClaim(
  data: any,
  schemaId = 'firestartr.dev://common/ClaimEnvelope',
) {
  if (!('kind' in data && 'name' in data)) {
    throw new Error(`Invalid claim file ${data}, missing kind or name`);
  }

  const v = prepareValidation(schemaId);

  if (!v(data)) {
    console.log('---- SCHEMA VALIDATION ----');
    console.log(`${data.kind}-${data.name}`);
    console.log(v.errors);
    throw v.errors;
  }
}

export * from './optionalValidations';
