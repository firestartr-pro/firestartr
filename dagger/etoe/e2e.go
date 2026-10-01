package main

import (
	"context"
	"dagger/etoe/internal/dagger"
)

func (m *Etoe) PrepareTestContainer(
	ctx context.Context,
	kindContainer *dagger.Container,
	projectDir *dagger.Directory,
) (*dagger.Container, error) {
	ctn, err := kindContainer.
		WithExec([]string{"apk", "add", "npm", "nodejs", "python3", "build-base"}).
		WithMountedDirectory("/library", projectDir).
		WithWorkdir("/library").
		WithExec([]string{
			"npm", "install",
		}).
		Sync(ctx)

	return ctn, err
}
