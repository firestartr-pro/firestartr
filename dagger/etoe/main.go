// A generated module for Etoe functions
//
// This module has been generated via dagger init and serves as a reference to
// basic module structure as you get started with Dagger.
//
// Two functions have been pre-created. You can modify, delete, or add to them,
// as needed. They demonstrate usage of arguments and return types using simple
// echo and grep commands. The functions can be called from the dagger CLI or
// from one of the SDKs.
//
// The first line in this comment block is a short description line and the
// rest is a long description with more detail on the module's purpose or usage,
// if appropriate. All modules should have a short description.

package main

import (
	"context"
	"fmt"

	"dagger/etoe/internal/dagger"
)

type Etoe struct {
	Config             *E2EConfig
	AWSAccessKey       *dagger.Secret
	AWSSecretAccessKey *dagger.Secret
	AWSSessionToken    *dagger.Secret
	GithubAppID        *dagger.Secret
	GithubAppPemFile   *dagger.Secret
	PrefappBotPAT      *dagger.Secret
}

func New(
	ctx context.Context,
	config *dagger.Secret,
	// +optional
	awsAccessKey *dagger.Secret,
	// +optional
	awsSecretAccessKey *dagger.Secret,
	// +optional
	awsSessionToken *dagger.Secret,
	// +optional
	githubAppID *dagger.Secret,
	// +optional
	githubAppPemFile *dagger.Secret,
	// +optional
	prefappBotPAT *dagger.Secret,
) (*Etoe, error) {
	if config == nil {
		return nil, fmt.Errorf("e2e config secret handle is required")
	}

	content, err := config.Plaintext(ctx)
	if err != nil {
		return nil, fmt.Errorf("unable to read e2e config secret")
	}

	e2eConfig, err := parseE2EConfig(content)
	if err != nil {
		return nil, err
	}

	return &Etoe{
		Config:             e2eConfig,
		AWSAccessKey:       awsAccessKey,
		AWSSecretAccessKey: awsSecretAccessKey,
		AWSSessionToken:    awsSessionToken,
		GithubAppID:        githubAppID,
		GithubAppPemFile:   githubAppPemFile,
		PrefappBotPAT:      prefappBotPAT,
	}, nil
}
