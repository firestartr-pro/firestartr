package main

import (
	"context"
	"dagger/etoe/internal/dagger"
	"fmt"
	"strconv"
	"strings"
)

func (m *Etoe) prepareKindBridgeContainer(
	ctx context.Context,
	kubeconfig *dagger.Directory,
	kindSvc *dagger.Service,
	kindClusterName string,
) (*dagger.Container, error) {
	endpoint, err := kindSvc.Endpoint(ctx)
	if err != nil {
		return nil, err
	}

	lastColon := strings.LastIndex(endpoint, ":")
	if lastColon < 0 {
		return nil, fmt.Errorf("kind service endpoint %q does not include a port", endpoint)
	}

	port, err := strconv.Atoi(endpoint[lastColon+1:])
	if err != nil {
		return nil, fmt.Errorf("invalid kind service endpoint %q: %w", endpoint, err)
	}

	container, err := dag.Container().
		From("alpine:3.22").
		WithExec([]string{"apk", "add", "--no-cache", "kubectl"}).
		WithMountedDirectory("/root/.kube", kubeconfig).
		WithWorkdir("/workspace").
		WithServiceBinding("localhost", kindSvc).
		WithExec([]string{
			"kubectl", "config",
			"set-cluster", fmt.Sprintf("kind-%s", kindClusterName), fmt.Sprintf("--server=https://localhost:%d", port),
		}).
		Sync(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to create bridge container to kind cluster: %w", err)
	}

	return container, nil
}
