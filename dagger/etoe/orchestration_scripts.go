package main

// bootOperatorShellScript assembles the shell script that boots the controller
// for the e2e suites: it locates the controller deployment and its ConfigMap,
// applies the e2e ORG, appends any missing kinds required by e2e suites, and
// — only for the CRD-upgrade v2.6.4 baseline — overrides OPERATOR_KIND_LIST
// with the kinds that immutable image supports.
//
// The target operator always receives the chart's configured kind list
// (plus e2e-required kinds) unchanged: it filters that list through its own
// implementation registry at startup and warns about unsupported entries.
func bootOperatorShellScript() string {
	return "set -eu\n" +
		findControllerDeploymentShellScript() +
		findControllerConfigMapShellScript() +
		filterBaselineKindListShellScript() +
		`if [ -n "$cm" ]; then
  kubectl -n default patch configmap "$cm" --type merge -p "{\"data\":{\"ORG\":\"${FIRESTARTR_E2E_ORG}\"}}"
fi` + "\n" +
		// Read the current kind list from the deployment env (Helm chart may set
		// OPERATOR_KIND_LIST directly on the container) and fall back to ConfigMap.
		`current="$(kubectl -n default get deployment "$dep" -o jsonpath='{range .spec.template.spec.containers[0].env[*]}{.name}={.value}{"\n"}{end}' | grep '^OPERATOR_KIND_LIST=' | cut -d= -f2- || true)"
if [ -z "$current" ] && [ -n "$cm" ]; then
  current="$(kubectl -n default get configmap "$cm" -o jsonpath='{.data.OPERATOR_KIND_LIST}' 2>/dev/null || true)"
fi` + "\n" +
		// Append e2e-required kinds that may not yet be in the chart's default list.
		`for required_kind in githuborganizationvariablesections; do
  case ",$current," in
    *",$required_kind,"*) ;;
    *)
      if [ -z "$current" ]; then
        current="$required_kind"
      else
        current="$current,$required_kind"
      fi
      echo "e2e: appended required kind '$required_kind' to OPERATOR_KIND_LIST" >&2
      ;;
  esac
done` + "\n" +
		// Set the resolved kind list (plus ORG) directly on the deployment env.
		`if [ -n "${baseline_kind_list:-}" ]; then
  kubectl -n default set env "deployment/$dep" ORG="${FIRESTARTR_E2E_ORG}" OPERATOR_KIND_LIST="$baseline_kind_list" "OPERATOR_NUMBER_OF_MAX_SLOTS=${FIRESTARTR_MAX_SLOTS:-1}"
else
  kubectl -n default set env "deployment/$dep" ORG="${FIRESTARTR_E2E_ORG}" "OPERATOR_KIND_LIST=${current}" "OPERATOR_NUMBER_OF_MAX_SLOTS=${FIRESTARTR_MAX_SLOTS:-1}"
fi` + "\n" +
		waitForControllerRolloutAndPodStabilizationShellScript()
}

// filterBaselineKindListShellScript intersects the configured target kinds with
// the baseline capabilities while preserving target order.
func filterBaselineKindListShellScript() string {
	return `if [ -n "${FIRESTARTR_BASELINE_KINDS:-}" ]; then
  if [ -z "$cm" ]; then
    echo "crd-upgrade: controller ConfigMap not found; cannot filter baseline kinds" >&2
    exit 1
  fi
  current="$(kubectl -n default get configmap "$cm" -o jsonpath='{.data.OPERATOR_KIND_LIST}')"
  if [ -z "$current" ]; then
    echo "crd-upgrade: OPERATOR_KIND_LIST is empty or missing; cannot filter baseline kinds" >&2
    exit 1
  fi
  filtered=""
  old_ifs="$IFS"; IFS=','
  for k in $current; do
    k="$(printf '%s' "$k" | tr -d '[:space:]')"
    [ -z "$k" ] && continue
    case " $FIRESTARTR_BASELINE_KINDS " in
      *" $k "*)
        if [ -z "$filtered" ]; then filtered="$k"; else filtered="$filtered,$k"; fi
        ;;
      *)
        echo "crd-upgrade: target kind '$k' is not implemented by the baseline operator; excluding it from baseline boot (no allowlist update is needed)" >&2
        ;;
    esac
  done
  IFS="$old_ifs"
  if [ -z "$filtered" ]; then
    echo "crd-upgrade: no configured kinds are implemented by the baseline operator" >&2
    exit 1
  fi
  baseline_kind_list="$filtered"
fi
`
}

func operatorUpgradeShellScript(restoreTargetKinds bool) string {
	if restoreTargetKinds {
		// Remove the baseline-only env override in the same deployment update that
		// switches images, so no baseline pod can restart with the full target list.
		return `patch="$(printf '{"spec":{"template":{"spec":{"containers":[{"name":"%s","image":"%s","imagePullPolicy":"%s","env":[{"name":"OPERATOR_KIND_LIST","$patch":"delete"}]}]}}}}' "$container_name" "$FIRESTARTR_TARGET_IMAGE" "$FIRESTARTR_TARGET_PULL_POLICY")"` + "\n" +
			`kubectl -n default patch deployment "$dep" --type strategic -p "$patch"` + "\n"
	}

	return `kubectl -n default set image "deployment/$dep" "$container_name=${FIRESTARTR_TARGET_IMAGE}"` + "\n" +
		`kubectl -n default patch deployment "$dep" --type json -p "[{\"op\":\"replace\",\"path\":\"/spec/template/spec/containers/0/imagePullPolicy\",\"value\":\"${FIRESTARTR_TARGET_PULL_POLICY}\"}]"` + "\n"
}
