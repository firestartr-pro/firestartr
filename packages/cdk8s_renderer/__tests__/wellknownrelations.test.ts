import { isCollaborator } from "../src/validations/wellKnownStructures";


describe('Well known relations', () => {

    it('can detect a well known structure', async () => {

        expect(isCollaborator({
            collaborator: "a",
            role: "b"
        })).toBe(true)

        expect(isCollaborator({})).toBe(false)

        expect(isCollaborator(
            {
                ref: {
                    kind: "a",
                    name: "b"
                },
                role: "c"
            }
          )
        ).toBe(false)

    });

});
