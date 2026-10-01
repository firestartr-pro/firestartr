package main

import (
  "context"
  "dagger/local-dev/internal/dagger"
  "fmt"
)

func (m *LocalDev) Up(ctx context.Context) (*dagger.Container, error) {
  bridge := dag.FirestartrCore().
    PrepareOperatorLocal(
      m.Kubeconfig,
      m.KindSvc,
      m.clusterName(),
      m.chartVersion(),
      "nginx:alpine",
    )

  bridge = bridge.
    WithDirectory("/source", m.Source).
    WithExec([]string{
      "sh", "-c",
      fmt.Sprintf(
        "kubectl create namespace dev --dry-run=client -o yaml --context kind-%s | kubectl apply -f - --context kind-%s",
        m.clusterName(), m.clusterName(),
      ),
    }).
    WithExec([]string{
      "sh", "-c",
      fmt.Sprintf(
        "kubectl apply -f /source/packages/k8s/src/crds --context kind-%s && kubectl apply -f /source/packages/k8s/dev/dummy-crds --context kind-%s",
        m.clusterName(), m.clusterName(),
      ),
    })

  var err error
  bridge, err = bridge.Sync(ctx)
  if err != nil {
    return nil, fmt.Errorf("applying crds and namespace: %w", err)
  }

  devBridge, err := dag.FirestartrCore().
    LaunchDevPod(
      m.Kubeconfig,
      m.KindSvc,
      m.clusterName(),
      m.devImageTag(),
      "/development",
    ).Sync(ctx)

  if err != nil {
    return nil, fmt.Errorf("preparing dev pod manifest: %w", err)
  }

  _, err = devBridge.
    WithExec([]string{
      "sh", "-c",
      fmt.Sprintf(
        "kubectl apply -f /home/pod.yaml --context kind-%s -n default",
        m.clusterName(),
      ),
    }).Sync(ctx)

  if err != nil {
    return nil, fmt.Errorf("applying dev pod: %w", err)
  }

  return bridge.
    WithWorkdir("/source/packages/operator"), nil
}

func (m *LocalDev) Down(ctx context.Context) (string, error) {
  return "Use run.sh --down to delete the cluster.", nil
}

func (m *LocalDev) Shell(ctx context.Context) (*dagger.Container, error) {
  return dag.FirestartrCore().
    PrepareOperatorLocal(
      m.Kubeconfig,
      m.KindSvc,
      m.clusterName(),
      m.chartVersion(),
      "nginx:alpine",
    ).
    WithDirectory("/source", m.Source).
    WithWorkdir("/source/packages/operator"), nil
}
