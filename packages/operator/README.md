# Demo operator

## Requirements

* kubectl installed
* docker installed
* kind installed
* A Github PAT created

## To initialize the kind cluster and local container

In the root directory of the repository:

```shell
bash kind.sh create   
```
Go to k9s and open a shell in the firestartr-local container

![k9s with the firestartr-local pod selected](docs/operator.png)

Execute in the container

```
export TOKEN_GITHUB=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

cd /home/app

./scripts/init.sh ${TOKEN_GITHUB}
```

## Apply manifests

* Open a new terminal
* From the git repository, go to `packages/k8s/__tests__/fixtures/groups`
* `kubectl apply -f group_a.yaml`
