#!/bin/bash

kubectl patch githubgroups rename-group-a -p '{"metadata":{"finalizers":null}}' --type=merge
kubectl delete -n default githubgroups rename-group-a

kubectl patch githubgroups rename-group-b -p '{"metadata":{"finalizers":null}}' --type=merge
kubectl delete -n default githubgroups rename-group-b

read -r -d '' GROUP_A << EOM
apiVersion: firestartr.dev/v1
kind: FirestartrGithubGroup
metadata:
  name: rename-group-a
spec:
  firestartr:
    tfStateKey: 2d0203cc-2e9d-4878-8f58-5697e69d0a26
  org: firestartr-test
  privacy: closed
  description: "test description"

  writeConnectionSecretToRef:
    name: firestartrgithubgroup-rename-group-a-outputs
    outputs:
      - key: id
      - key: nodeId
      - key: slug

  firestartr:
    tfStateKey: c453eda8-2676-4d17-8b07-2bb20bc69294
    catalog:
      - name: firestartr-test
        kind: group
        type: business-unit
        profile:
          displayName: testGroupa
          email: test@test.test

  members: []

EOM

read -r -d '' GROUP_B << EOM
apiVersion: firestartr.dev/v1
kind: FirestartrGithubGroup
metadata:
  name: rename-group-b
  labels:
    firestartr.dev/old-name: rename-group-a
spec:
  firestartr:
    tfStateKey: 2d0203cc-2e9d-4878-8f58-5697e69d0a26
  org: firestartr-test
  privacy: closed
  description: "test description"

  writeConnectionSecretToRef:
    name: firestartrgithubgroup-rename-group-b-outputs
    outputs:
      - key: id
      - key: nodeId
      - key: slug

  firestartr:
    tfStateKey: c453eda8-2676-4d17-8b07-2bb20bc69294
    catalog:
      - name: firestartr-test
        kind: group
        type: business-unit
        profile:
          displayName: testGroupa
          email: test@test.test

  members: []
EOM

echo "$GROUP_A" | kubectl apply -n default -f -

read -n 1 -p 'Created rename-group-a, press for continue...'

echo "$GROUP_B" | kubectl apply -n default -f -

read -n 1 -p 'Renamed rename-group-a to rename-group-b, press for continue...'

kubectl delete -n default githubgroups rename-group-a
