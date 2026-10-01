
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

});
