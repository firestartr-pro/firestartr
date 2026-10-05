package main

import "strings"

func legacyBaselineCapabilities(imageTag string) ([]string, bool) {
	version, _, _ := strings.Cut(strings.TrimSpace(imageTag), "_")
	if version != "v2.6.4" {
		return nil, false
	}

	return []string{
        "terraformworkspaces",
		"githubgroups",
		"githubrepositories",
		"githubrepositorysecretssections",
		"githubrepositoryfeatures",
		"githubmemberships",
		"githuborgwebhooks",
		"fsdummiesa",
		"fsdummiesb",
		"fsdummiesc",
	}, true
}
