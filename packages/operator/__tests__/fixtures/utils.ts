const items: any = {
    "test-namespace/githubrepositories/test-name-1": {
        kind: "FirestartrGithubRepository",
        metadata: {
            name: "test-name-1",
            namespace: "test-namespace"
        },
        spec: {
            owner:{
                ref:{
                    kind: "FirestartrGithubRepository",
                    name: "test-name-2"
                }
            },
            maintainers: []
        }
    },
    "test-namespace/githubrepositories/test-name-2": {
        kind: "FirestartrGithubRepository",
        metadata: {
            name: "test-name-2",
            namespace: "test-namespace"
        },
        spec: {
            owner:{
                ref:{
                    kind: "FirestartrGithubRepository",
                    name: "test-name-2"
                }
            },
            maintainers: []
        }
    },
    "test-namespace/githubrepositories/test-name-3": {
        kind: "FirestartrGithubRepository",
        metadata: {
            name: "test-name-3",
            namespace: "test-namespace"
        },
        spec: {
            owner:{
                ref:{
                    kind: "FirestartrGithubRepository",
                    name: "test-name-2"
                }
            },
            maintainers: []
        }
    },
    "test-namespace/githubrepositories/test-name-4": {
        kind: "FirestartrGithubRepository",
        metadata: {
            name: "test-name-4",
            namespace: "test-namespace"
        },
        spec: {
            owner:{
                ref:{
                    kind: "FirestartrGithubRepository",
                    name: "test-name-2"
                }
            },
            maintainers: []
        }
    },
}


export const getItemByItemPathMockFn = async (itemPath: string) =>{

    console.log("getItemByItemPath", itemPath)

    console.log("getItemPath", items[itemPath])

    return items[itemPath]
}


export const getSecretMockFn = async (namespace: string, secretName: string) =>{
    return {
        data: {
            "test-key": ""
        }
    }
}
