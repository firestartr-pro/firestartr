import _ from 'lodash';

import Ajv from 'ajv/dist/2020';

import * as fs from 'fs';

const OptionalValidations = {
  TFWorkspace: {
    schema: 'providers.terraform.valuesSchema',

    section: 'providers.terraform.values',
  },
};

export async function optionalValidation(data: any) {
  const pointer: any = (OptionalValidations as any)[data.kind];

  if (pointer) {
    const schemaURI: any = _.get(data, pointer.schema);

    if (schemaURI) {
      const schemaValidation = new Ajv().compile(await loadSchema(schemaURI));

      if (!schemaValidation(_.get(data, pointer.section))) {
        throw `${data.kind}/${data.name} is not valid: section [${pointer.section}] not valid according to ${schemaURI}: ${JSON.stringify(schemaValidation.errors)}`;
      }
    }
  }
}

async function loadSchema(schemaURI: string) {
  if (schemaURI.match(/^http/)) {
    return fetch(schemaURI)
      .then((r: any) => r.json())
      .catch((err: string) => {
        throw `Error loading schema ${schemaURI}: ${err}`;
      });
  } else if (schemaURI.match(/^file:/)) {
    return new Promise((ok: Function, ko: Function) => {
      fs.readFile(
        schemaURI.replace(/^file:/, ''),
        'utf-8',
        (err: any, data: string) => {
          if (err) {
            return ko(`Error loading schema ${schemaURI}: ${err}`);
          } else {
            return ok(JSON.parse(data));
          }
        },
      );
    });
  } else {
    throw `Invalid schemaURI: ${schemaURI}`;
  }
}
