package main

import (
  "context"
  "dagger/local-dev/internal/dagger"
)

type LocalDev struct {
  Source       *dagger.Directory
  Kubeconfig   *dagger.Directory
  KindSvc      *dagger.Service
  ChartVersion string
}

func New(
  ctx context.Context,
  // +required
  source *dagger.Directory,
  // +required
  kubeconfig *dagger.Directory,
  // +required
  kindSvc *dagger.Service,
  // +optional
  chartVersion string,
) (*LocalDev, error) {
  return &LocalDev{
    Source:       source,
    Kubeconfig:   kubeconfig,
    KindSvc:      kindSvc,
    ChartVersion: chartVersion,
  }, nil
}

func (m *LocalDev) clusterName() string {
  return "firestartr-local-dev"
}

func (m *LocalDev) devImageTag() string {
  return "firestartr-local-dev:latest"
}

func (m *LocalDev) chartVersion() string {
  if m.ChartVersion != "" {
    return m.ChartVersion
  }
  return "3.4.1"
}
