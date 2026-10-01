package main

import (
	"encoding/json"
	"os/exec"
	"strings"
	"testing"
)

func TestBaselineKindFilterPreservesTargetOrderAndReportsExclusions(t *testing.T) {
	script := `kubectl() { printf '%s' 'terraformworkspaces,githuborganizationsettings,githubgroups'; }
cm=operator-config
FIRESTARTR_BASELINE_KINDS='githubgroups terraformworkspaces'
` + filterBaselineKindListShellScript() + `
printf 'filtered=%s\n' "$baseline_kind_list"
`
	output, err := exec.Command("sh", "-c", script).CombinedOutput()
	if err != nil {
		t.Fatalf("baseline kind filter failed: %v\n%s", err, output)
	}
	for _, expected := range []string{
		"filtered=terraformworkspaces,githubgroups",
		"target kind 'githuborganizationsettings' is not implemented by the baseline operator",
	} {
		if !strings.Contains(string(output), expected) {
			t.Fatalf("baseline kind filter output does not contain %q:\n%s", expected, output)
		}
	}
}

func TestOperatorUpgradeRestoresTargetKindsAtomically(t *testing.T) {
	script := operatorUpgradeShellScript(true)
	if strings.Contains(script, "set image") || strings.Count(script, "kubectl -n default patch deployment") != 1 {
		t.Fatalf("upgrade is not a single deployment patch:\n%s", script)
	}
	for _, required := range []string{"FIRESTARTR_TARGET_IMAGE", "FIRESTARTR_TARGET_PULL_POLICY", `"name":"OPERATOR_KIND_LIST","$patch":"delete"`} {
		if !strings.Contains(script, required) {
			t.Fatalf("upgrade patch does not contain %q:\n%s", required, script)
		}
	}
}

// TestOperatorUpgradePatchIsValidJSON guards against non-portable printf escaping:
// dash/busybox printf leaves an unrecognized `\"` escape literal, producing invalid
// JSON that kubectl rejects. Run the patch-building printf through /bin/sh and assert
// the rendered patch parses as JSON.
func TestOperatorUpgradePatchIsValidJSON(t *testing.T) {
	script := `container_name=ctrl
FIRESTARTR_TARGET_IMAGE=img
FIRESTARTR_TARGET_PULL_POLICY=Never
` + operatorUpgradeShellScript(true)
	// Replace the kubectl invocation with an echo of the built patch.
	script = strings.Replace(script, `kubectl -n default patch deployment "$dep" --type strategic -p "$patch"`, `printf '%s' "$patch"`, 1)
	output, err := exec.Command("sh", "-c", script).CombinedOutput()
	if err != nil {
		t.Fatalf("upgrade patch script failed: %v\n%s", err, output)
	}
	var parsed any
	if err := json.Unmarshal(output, &parsed); err != nil {
		t.Fatalf("upgrade patch is not valid JSON: %v\n%s", err, output)
	}
	// Host-independent guard: the single-quoted printf format must not contain a
	// backslash-escaped quote, which dash/busybox printf would leave literal.
	if strings.Contains(operatorUpgradeShellScript(true), `\"`) {
		t.Fatalf("upgrade patch printf contains non-portable \\\" escape:\n%s", operatorUpgradeShellScript(true))
	}
}

// TestBootOperatorScriptLeavesChartKindListUntouched guards the bootOperator shell
// script: the chart's configured OPERATOR_KIND_LIST must reach the target operator
// with only e2e-required kinds appended. Regression for the org-settings-render-apply
// e2e failure caused by a kind-exclusion branch that skipped
// githuborganizationsettings even though the operator image implements it.
// The operator filters its own kind list at startup (issue #2355), so E2E must not
// maintain its own capability filter.
func TestBootOperatorScriptLeavesChartKindListUntouched(t *testing.T) {
	script := bootOperatorShellScript()

	// No per-kind exclusion branch may exist in the boot script.
	if strings.Contains(script, "skipping kind") || strings.Contains(script, "githuborganizationsettings)") {
		t.Fatalf("boot script still contains a kind-exclusion branch:\n%s", script)
	}

	// The chart ConfigMap must not be wholesale rewritten with a static
	// OPERATOR_KIND_LIST value. Dynamic append (reading current value, then
	// conditionally patching) is allowed for e2e-required kinds.
	if strings.Contains(script, `"OPERATOR_KIND_LIST":"github`) {
		t.Fatalf("boot script rewrites the chart ConfigMap's OPERATOR_KIND_LIST with a static value:\n%s", script)
	}

	// The non-baseline path must not override OPERATOR_KIND_LIST on the deployment
	// (the baseline bridge uses OPERATOR_KIND_LIST="$baseline_kind_list" and is fine).
	if strings.Contains(script, `OPERATOR_KIND_LIST="${`) {
		t.Fatalf("boot script overrides OPERATOR_KIND_LIST in the non-baseline path:\n%s", script)
	}

	// The v2.6.4 baseline bridge keeps its sanctioned deployment override.
	if !strings.Contains(script, `OPERATOR_KIND_LIST="$baseline_kind_list"`) {
		t.Fatalf("boot script lost the baseline OPERATOR_KIND_LIST override:\n%s", script)
	}

	// The boot script must append e2e-required kinds to the ConfigMap.
	if !strings.Contains(script, "githuborganizationvariablesections") {
		t.Fatalf("boot script does not append githuborganizationvariablesections to the kind list:\n%s", script)
	}
}

func TestRepoSecretsSuitesEnableProviderSecretEncryption(t *testing.T) {
	for _, suites := range []string{
		"component-repo-secrets-render-apply",
		"github",
		"all",
		"unit,component-repo-secrets-render-apply",
	} {
		if !shouldEnableProviderSecretEncryption(suites) {
			t.Fatalf("suite selection %q did not enable provider secret encryption", suites)
		}
	}

	if shouldEnableProviderSecretEncryption("unit") {
		t.Fatal("unrelated suite enabled provider secret encryption")
	}
}

func TestLegacyBaselineCapabilitiesAreRestrictedToV264Images(t *testing.T) {
	if kinds, ok := legacyBaselineCapabilities("v2.6.4_full-aws"); !ok || len(kinds) == 0 {
		t.Fatal("v2.6.4 legacy capabilities are unavailable")
	}
	for _, imageTag := range []string{"v2.6.40_full-aws", "v2.6.5_full-aws", "latest_full-aws"} {
		if _, ok := legacyBaselineCapabilities(imageTag); ok {
			t.Fatalf("image %q received the v2.6.4 legacy capabilities", imageTag)
		}
	}
}
