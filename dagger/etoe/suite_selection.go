package main

import "strings"

const crdUpgradeSuite = "crd-upgrade"
const orgScriptCrdUpgradeSuite = "org-script-crd-upgrade"
const k8sRateLimitsSuite = "k8s-rate-limits"
const repoSecretsSuite = "component-repo-secrets-render-apply"

func suitesWithoutCrdUpgrade(suites string) string {
	selected := []string{}
	for _, suite := range strings.Split(suites, ",") {
		normalized := strings.TrimSpace(suite)
		if normalized == "" || isCrdUpgradeSuite(normalized) {
			continue
		}

		selected = append(selected, normalized)
	}

	return strings.Join(selected, ",")
}

func shouldRunCrdUpgrade(suites string) bool {
	return suiteSelectionIncludes(suites, "all") || suiteSelectionIncludesCrdUpgrade(suites)
}

func shouldRunOnlyCrdUpgrade(suites string) bool {
	requested := normalizedSuites(suites)
	if len(requested) != 1 {
		return false
	}

	return isCrdUpgradeSuite(requested[0])
}

func shouldRunK8sRateLimits(suites string) bool {
	return suiteSelectionIncludes(suites, k8sRateLimitsSuite) || suiteSelectionIncludes(suites, "k8s-api-rate-limits")
}

func shouldEnableProviderSecretEncryption(suites string) bool {
	return suiteSelectionIncludes(suites, repoSecretsSuite) ||
		suiteSelectionIncludes(suites, "github") ||
		suiteSelectionIncludes(suites, "all")
}

func suiteSelectionIncludes(suites string, expected string) bool {
	for _, suite := range normalizedSuites(suites) {
		if suite == strings.ToLower(expected) {
			return true
		}
	}

	return false
}

func suiteSelectionIncludesCrdUpgrade(suites string) bool {
	for _, suite := range normalizedSuites(suites) {
		if isCrdUpgradeSuite(suite) {
			return true
		}
	}

	return false
}

func isCrdUpgradeSuite(suite string) bool {
	normalized := strings.ToLower(strings.TrimSpace(suite))
	return normalized == crdUpgradeSuite || normalized == orgScriptCrdUpgradeSuite
}

func normalizedSuites(suites string) []string {
	normalized := []string{}
	for _, suite := range strings.Split(suites, ",") {
		trimmed := strings.TrimSpace(strings.ToLower(suite))
		if trimmed != "" {
			normalized = append(normalized, trimmed)
		}
	}

	return normalized
}
