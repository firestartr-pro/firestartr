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
		WithExec([]string{"apk", "add", "npm", "python3", "build-base"}).
		// The base image comes from the upstream firestartr-core module and follows
		// "alpine:latest", so apk would hand us whatever Node that Alpine ships (3.22
		// carries Node 22). The repository requires Node 24 (ADR 0006). Take it from a
		// pinned repository so the version does not drift with the moving base.
		WithExec([]string{"apk", "add", "--no-cache", "--repository", "https://dl-cdn.alpinelinux.org/alpine/v3.24/main", "nodejs~24"}).
		WithMountedDirectory("/library", projectDir).
		WithWorkdir("/library").
		WithExec([]string{"sh", "-c", `npm install -g "$(node -p "require('./package.json').packageManager")"`}).
		WithExec([]string{
			"npm", "install",
		}).
		Sync(ctx)

	return ctn, err
}
