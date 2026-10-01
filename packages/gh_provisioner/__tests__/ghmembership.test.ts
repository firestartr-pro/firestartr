import {initSystemFS} from "../src"

import path from "path"

import {EntityGHMembership} from "../src/entities/ghmembership"

describe("EntityGHMembership entity", () => {

    let entity: EntityGHMembership;

    beforeEach(async () => {
    
        entity = await initSystemFS(

            path.join(__dirname, "fixtures/ghmembership/cr.yaml"),
        
            path.join(__dirname, "fixtures/ghmembership/deps.yaml"),
        
        ) as EntityGHMembership
    })

    it("is able to render its values", async () => {
    
        expect(entity instanceof EntityGHMembership).toBe(true)

        const mockTeamInfo = {
            id: 123,
            name: "mock-team",
            slug: "mock-team",
            description: "A mock team for testing",
            privacy: "closed",
            permission: "admin",
            members_count: 5,
            repos_count: 3,
        };

        jest.spyOn(entity, 'runWithGithubProvider').mockResolvedValue(mockTeamInfo);

        await entity.loadResources("apply")

		console.log(JSON.stringify(entity.document, null, 2))
    })

    it("explains missing organization all-team errors", async () => {
        jest.spyOn(entity, 'runWithGithubProvider').mockRejectedValue(
            Object.assign(
                new Error('HttpError: Not Found - https://docs.github.com/rest/teams/teams#get-a-team-by-name'),
                { status: 404 },
            ),
        )

        await expect(entity.loadResources("plan")).rejects.toThrow(
            'Could not find required GitHub team "example-org-all" in org "example-org" while loading membership for user "user-b" (UserClaim/user-b). Check UserClaim.providers.github.org / FirestartrGithubMembership.spec.org',
        )
    })

    describe("loadAddressesToImport", () => {

        const mockTeamInfo = {
            id: 123,
            name: 'example-org-all',
        };

        it("omits all-team membership import when user is not a member", async () => {
            const spy = jest.spyOn(entity, 'runWithGithubProvider');

            // First call: provisionAllGroupMembershipRelation -> getTeamInfo
            spy.mockResolvedValueOnce(mockTeamInfo);
            // Second call: allGroupMembershipRelationExists -> getTeamRoleUser returns 404 (not a member)
            spy.mockResolvedValueOnce(false);

            await entity.loadResources('plan');
            await entity.loadAddressesToImport();

            const imports = entity.importDocument.imports;

            expect(imports).toContainEqual({
                to: 'github_membership.this[0]',
                id: 'example-org:user-b',
            });

            expect(imports).not.toContainEqual(
                expect.objectContaining({
                    to: expect.stringContaining('user-b-123'),
                }),
            );
        });

        it("includes all-team membership import when user is a member", async () => {
            const spy = jest.spyOn(entity, 'runWithGithubProvider');

            // First call: provisionAllGroupMembershipRelation -> getTeamInfo
            spy.mockResolvedValueOnce(mockTeamInfo);
            // Second call: allGroupMembershipRelationExists -> getTeamRoleUser succeeds (is a member)
            spy.mockResolvedValueOnce(true);

            await entity.loadResources('plan');
            await entity.loadAddressesToImport();

            const imports = entity.importDocument.imports;

            expect(imports).toContainEqual({
                to: 'github_membership.this[0]',
                id: 'example-org:user-b',
            });

            expect(imports).toContainEqual({
                to: 'github_team_membership.relationships["user-b-123"]',
                id: '123:user-b',
            });
        });

    });

})
