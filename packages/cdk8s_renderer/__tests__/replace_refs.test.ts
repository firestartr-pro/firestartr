import { replaceReferences } from "../src/normalizers/refValues";

describe('Replace references', () => {

    it('Is able to replace references', async () => {


        const originalValues = {
            "test1": "${{ tfworkspace:test-B:outputs.id }}",
            nested: {
                "test2": "${{ tfworkspace:test-B:outputs.name }}"
            },
            "test3": "${{ tfworkspace:test-B:outputs.id }}-${{ tfworkspace:test-B:outputs.name }}",
            "test4": {
                "test5": [
                    "${{ tfworkspace:test-B:outputs.id }}",
                    "${{ tfworkspace:test-B:outputs.name }}"
                ],
            },
            "test6": [{
                "test7": "${{ tfworkspace:test-B:outputs.id }}",
                "test8": "${{ tfworkspace:test-B:outputs.name }}"
            }],
            "test9": [
              false,
              42,
              [{
                "test10": [null, "${{ tfworkspace:test-B:outputs.id }}", "ahdsfkjads", 123],
                "test11": null,
              }, {
                "test12": {
                  "test13": "${{ tfworkspace:test-B:outputs.name }}",
                  "test14": [],
                }
              }]
            ],
            "testclaim0": "ref:secretsclaim:secret_a:foo",
            "testclaim1": "ref:secretsclaim:secret_a:foo2",
            "testclaim2": "ref:secretsclaim:secret_a:foo",
        }

        function resolver(_kind: string, _name: string) {
            return {
                apiVersion: 'firestartr.dev/v1',
                kind: 'FirestartrTerraformWorkspace',
                metadata: {
                    annotations: {
                        'firestartr.dev/claim-ref': 'TFWorkspaceClaim/test-b',
                        'firestartr.dev/external-name': 'test_b',
                        'firestartr.dev/policy': 'observe'
                    },
                    labels: { 'claim-ref': 'test-b' },
                    name: 'test-b-4fad1761-8795-4f4f-9f3c-9b5c46186668'
                },
                spec: {
                    context: {
                        backend: { ref: { kind: 'FirestartrProviderConfig', name: 'foo' } },
                        providers: [
                            {
                                ref: { kind: 'FirestartrProviderConfig', name: 'aws-westeurope' }
                            }
                        ]
                    },
                    firestartr: { tfStateKey: '4fad1761-8795-4f4f-9f3c-9b5c46186668' },
                    values: "{\"test2\":\"${{ references.test-a-da021e9d-a895-4a0c-9038-2dee36611330.name }}\",\"test1\":\"${{ test-a-da021e9d-a895-4a0c-9038-2dee36611330.id }}\"}",
                    module: "https://github.com/infra/acme-predev-aks@main",
                    source: 'Remote',
                    references: [
                        {
                            name: 'test-a-da021e9d-a895-4a0c-9038-2dee36611330.name',
                            ref: {
                                kind: 'FirestartrTerraformWorkspace',
                                name: 'test-a-da021e9d-a895-4a0c-9038-2dee36611330',
                                key: 'name'
                            }
                        },
                        {
                            name: 'test-a-da021e9d-a895-4a0c-9038-2dee36611330.id',
                            ref: {
                                kind: 'FirestartrTerraformWorkspace',
                                name: 'test-a-da021e9d-a895-4a0c-9038-2dee36611330',
                                key: 'id'
                            }
                        },
                    ]
                }
            }

        }

        const replaced = await replaceReferences(originalValues, resolver);

        console.dir(replaced, { depth: null });

        expect(replaced).toEqual({
            values: {
                test1: '${{ references.tfworkspace_test-b-4fad1761-8795-4f4f-9f3c-9b5c46186668.id }}',
                nested: {
                    test2: '${{ references.tfworkspace_test-b-4fad1761-8795-4f4f-9f3c-9b5c46186668.name }}'
                },
                test3: '${{ references.tfworkspace_test-b-4fad1761-8795-4f4f-9f3c-9b5c46186668.id }}-${{ references.tfworkspace_test-b-4fad1761-8795-4f4f-9f3c-9b5c46186668.name }}',
                test4: {
                    test5: [
                        '${{ references.tfworkspace_test-b-4fad1761-8795-4f4f-9f3c-9b5c46186668.id }}',
                        '${{ references.tfworkspace_test-b-4fad1761-8795-4f4f-9f3c-9b5c46186668.name }}'
                    ],
                },
                test6: [{
                    test7: '${{ references.tfworkspace_test-b-4fad1761-8795-4f4f-9f3c-9b5c46186668.id }}',
                    test8: '${{ references.tfworkspace_test-b-4fad1761-8795-4f4f-9f3c-9b5c46186668.name }}'
                }],
                test9: [
                    false,
                    42,
                    [{
                        test10: [null, '${{ references.tfworkspace_test-b-4fad1761-8795-4f4f-9f3c-9b5c46186668.id }}', 'ahdsfkjads', 123],
                        test11: null,
                    }, {
                        test12: {
                            test13: '${{ references.tfworkspace_test-b-4fad1761-8795-4f4f-9f3c-9b5c46186668.name }}',
                            test14: [],
                        }
                    }
                    ]
                ],
                testclaim0: 'secret-ref-0',
                testclaim1: 'secret-ref-1',
                testclaim2: 'secret-ref-0',
            },
            references: [
                {
                    name: 'tfworkspace_test-b-4fad1761-8795-4f4f-9f3c-9b5c46186668.id',
                    ref: {
                        kind: 'FirestartrTerraformWorkspace',
                        name: 'test-b-4fad1761-8795-4f4f-9f3c-9b5c46186668',
                        key: 'id'
                    }
                },
                {
                    name: 'tfworkspace_test-b-4fad1761-8795-4f4f-9f3c-9b5c46186668.name',
                    ref: {
                        kind: 'FirestartrTerraformWorkspace',
                        name: 'test-b-4fad1761-8795-4f4f-9f3c-9b5c46186668',
                        key: 'name'
                    }
                },
                {
                    name: 'secret-ref-0',
                    ref: {
                        kind: 'Secret',
                        name: 'secret_a',
                        key: 'foo'
                    }
                },
                {
                    name: 'secret-ref-1',
                    ref: {
                        kind: 'Secret',
                        name: 'secret_a',
                        key: 'foo2'
                    }
                }
            ]
        }
        );      

    });
});
