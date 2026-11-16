import { dotFirestartr, actions } from '../src/schemas';
import { schemas as organizationSchemas } from '../src/schemas/dot-firestartr';
import { schemas as actionSchemas } from '../src/schemas/actions';

test('schema index exposes both namespaces without copying their schema maps', () => {
  expect(dotFirestartr.schemas).toBe(organizationSchemas);
  expect(actions.schemas).toBe(actionSchemas);
  expect(actions.schemas['firestartr-apps']).toBe(dotFirestartr.apps);
});
