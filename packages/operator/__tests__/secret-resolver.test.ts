
jest.mock('../src/logger', () => ({
    __esModule: true,
    default: {
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
        silly: jest.fn(),
    },
}));

import log from '../src/logger';
import { resolveSecretRef } from '../src/resolver';
import { getSecretMockFn } from './fixtures/utils';


describe('#secret resolver', () => {
    it('should resolve a secret ref', async () => {

        const secret = await resolveSecretRef("default", {
                "kind": "firestartrgithubrepository",
                "metadata": {
                    name: "test"
                },
            },
            getSecretMockFn
        )

        expect(secret).toBeDefined()

    });

    it('stays quiet when the secret is absent so the failure boundary logs once', async () => {
        const getSecret = jest.fn(async () => undefined);

        const secret = await resolveSecretRef(
            'default',
            {
                kind: 'FirestartrGithubRepository',
                metadata: { name: 'repo-a' },
            },
            getSecret,
        );

        expect(secret).toBeUndefined();

        // Absence is not logged here: ctl.getSecret already logged at debug
        // level, and the reconciliation boundary emits the single contextual
        // error carrying the referring CR, dependency, secret and namespace.
        expect(log.error).not.toHaveBeenCalled();
    });

});
