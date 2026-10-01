import { transformGraphQLResponse } from '../../github/src/organization';
describe('GraphQL Team Transformation', () => {
  it('should transform team members correctly', () => {

    const response = {
        "organization": {
          "teams": {
            "nodes": [
              {
                "name": "group-foo",
                "id": "group-foo-id",
                "repositories": {
                  "edges": []
                }
              },
              {
                "name": "group-bar",
                "id": "group-bar-id",
                "repositories": {
                  "edges": [
                    {
                      "permission": "admin",
                      "node": {
                        "name": "sample-repo"
                      }
                    }
                  ]
                }
              },
              {
                "name": "group-baz",
                "id": "group-baz-id",
                "repositories": {
                  "edges": [
                    {
                      "permission": "admin",
                      "node": {
                        "name": "sample-repo"
                      }
                    },
                    {
                      "permission": "admin",
                      "node": {
                        "name": "another-repo"
                      }
                    },
                  ]
                }
              },

            ]
          }
      }
    };

    const expected = {
      repositories: {
        "sample-repo": {
          "group-bar": {
              permission: "admin",
              slug: undefined,
          },
          "group-baz": {
              permission: "admin",
              slug: undefined,
          }
        },
        "another-repo": {
          "group-baz": {
              permission: "admin",
              slug: undefined,
          }
        }
      },
      teams: {
        "group-foo": { id: "group-foo-id" },
        "group-bar": { id: "group-bar-id" },
        "group-baz": { id: "group-baz-id" },
      }
    }

    const transformed = transformGraphQLResponse(response);

    expect(transformed).toEqual(expected);

  })
});
