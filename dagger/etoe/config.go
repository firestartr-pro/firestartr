package main

import (
	"fmt"

	"gopkg.in/yaml.v3"
)

func parseE2EConfig(content string) (*E2EConfig, error) {
	// Reject credentials before config is stored as a Dagger object.
	// YAML parse errors must not include attacker-controlled values.
	var document yaml.Node
	if err := yaml.Unmarshal([]byte(content), &document); err != nil {
		return nil, fmt.Errorf("invalid e2e config YAML")
	}
	if containsEmbeddedCredentials(&document) {
		return nil, fmt.Errorf("credentials must be provided as Dagger secrets, not in e2e config")
	}

	e2eConfig := &E2EConfig{}
	if err := document.Decode(e2eConfig); err != nil {
		return nil, fmt.Errorf("invalid e2e config fields")
	}
	return e2eConfig, nil
}

func containsEmbeddedCredentials(document *yaml.Node) bool {
	if document.Kind == yaml.DocumentNode && len(document.Content) == 1 {
		return containsEmbeddedCredentials(document.Content[0])
	}
	if document.Kind != yaml.MappingNode {
		return false
	}
	for i := 0; i+1 < len(document.Content); i += 2 {
		key, value := document.Content[i], document.Content[i+1]
		if isTestCredentialKey(key.Value) {
			return true
		}
		if key.Value != "credentials" {
			continue
		}
		if value.Kind == yaml.AliasNode {
			return true
		}
		if value.Kind != yaml.MappingNode {
			continue
		}
		for j := 0; j+1 < len(value.Content); j += 2 {
			if isTestCredentialKey(value.Content[j].Value) {
				return true
			}
		}
	}
	return false
}

func isTestCredentialKey(key string) bool {
	switch key {
	case "accessKey", "secretKey", "token", "GITHUB_APP_ID", "GITHUB_APP_PEM_FILE", "PREFAPP_BOT_PAT", "githubAppId", "githubAppPemFile", "prefappBotPat":
		return true
	}
	return false
}
