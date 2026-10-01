package main

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func TestConfigNeverStoresCredentialValues(t *testing.T) {
	canary := "E2E_CANARY_" + "PRIVATE_CREDENTIAL"
	for _, field := range []string{"accessKey", "secretKey", "token", "GITHUB_APP_ID", "GITHUB_APP_PEM_FILE", "PREFAPP_BOT_PAT", "githubAppId", "githubAppPemFile", "prefappBotPat"} {
		content := fmt.Sprintf("org: test\ncredentials:\n  region: eu-west-1\n  %s: %s\n", field, canary)
		config, err := parseE2EConfig(content)
		if err == nil || config != nil || strings.Contains(err.Error(), canary) {
			t.Fatalf("embedded %s was accepted or disclosed in error", field)
		}
	}
	for _, content := range []string{
		"GITHUB_APP_ID: " + canary,
		"GITHUB_APP_PEM_FILE: |\n  -----BEGIN SYNTHETIC KEY-----\n  " + canary + "\n  -----END SYNTHETIC KEY-----\n",
		"PREFAPP_BOT_PAT: " + canary,
		"org: [E2E_CANARY_PRIVATE_CREDENTIAL",
		"credentials:\n  region: [E2E_CANARY_PRIVATE_CREDENTIAL]",
		"credentials: &legacy\n  accessKey: E2E_CANARY_PRIVATE_CREDENTIAL\nother: *legacy",
		"legacy: &legacy {accessKey: E2E_CANARY_PRIVATE_CREDENTIAL}\ncredentials: *legacy",
	} {
		config, err := parseE2EConfig(content)
		if err == nil || config != nil || strings.Contains(err.Error(), canary) {
			t.Fatal("invalid config was accepted or canary appeared in failure")
		}
	}
}

func TestConfigStateCannotSerializeCredentialValues(t *testing.T) {
	canary := "E2E_CANARY_" + "PRIVATE_CREDENTIAL"
	config, err := parseE2EConfig("org: test\ncredentials:\n  region: eu-west-1\n")
	if err != nil {
		t.Fatal(err)
	}
	state, err := json.Marshal(config)
	if err != nil {
		t.Fatal(err)
	}
	for _, observable := range []string{string(state), fmt.Sprintf("%+v", config)} {
		if strings.Contains(observable, canary) || strings.Contains(observable, "AccessKey") || strings.Contains(observable, "SecretKey") || strings.Contains(observable, "Token") {
			t.Fatal("serialized e2e config contains a credential field or canary")
		}
	}
}
