import { envVars } from '../src/types/envvars';
import environment from '../src/environment';

let originalEnv: any = {};

beforeAll(() => {
  // Save original env
  originalEnv = process.env;
});

afterAll( () => {
  // Restore env
  process.env = originalEnv;
});

beforeEach(() => {
  // Clear the env
  process.env = {
    TERM: originalEnv.TERM,
    SHELL: originalEnv.SHELL,
    USER: originalEnv.USER,
    PATH: originalEnv.PATH,
    PWD: originalEnv.PWD,
    EDITOR: originalEnv.EDITOR,
    SHLVL: originalEnv.SHLVL,
    HOME: originalEnv.HOME,
    LOGNAME: originalEnv.LOGNAME,
    _: originalEnv._,
  };
});

describe('#environment', () => {
  it('With empty valiables, values must be undefined', () => {
    for (const envVar of Object.values(envVars)) {
      expect(environment.getFromEnvironment(envVar)).toBe(undefined);
      expect(environment.checkExistOnEnvironment(envVar)).toBe(false);
    }
  });

  it('With empty valiables, with default value, must be default value', () => {
    const defaultValue = 'testValue';
    for (const envVar of Object.values(envVars)) {
      expect(environment.checkExistOnEnvironment(envVar)).toBe(false);
      expect(environment.getFromEnvironmentWithDefault(envVar, defaultValue)).toBe(defaultValue);
    }
  })

  it('With values in variables, they must be defined', () => {
    // Defined variables and then test they are not empty
    for (const envVar of Object.values(envVars)) {
      process.env[envVar] = 'testValue';
      expect(environment.getFromEnvironment(envVar)).toBeDefined()
      expect(environment.checkExistOnEnvironment(envVar)).toBe(true);
    }
  })

  it('With text varialbes must can get them as boolean', () => {
    for (const envVar of Object.values(envVars)) {
      const random: string = Math.random() < 0.5 ? 'true' : 'false';
      const expectedValue = (random === 'true') ? true : false;
      process.env[envVar] = random;

      expect(environment.getFromEnvironmentAsBoolean(envVar)).toBe(expectedValue);
    }
  });
});
