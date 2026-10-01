package main

import (
	"context"
	"dagger/etoe/internal/dagger"
	"fmt"
	"strings"
)

func (m *Etoe) CmdRunTests(
	ctx context.Context,
	kubeconfig *dagger.Directory,
	kindSvc *dagger.Service,
	projectDir *dagger.Directory,
	suites string,
	// +optional
	kindClusterName string,
	// +optional
	imageTag string,
	// +optional
	chartVersion string,
	// +optional
	org string,
	// +optional
	customer string,
	// +optional
	crdUpgradeBaselineVersion string,
	// +optional
	crdUpgradeBaselineOperatorImageTag string,
	// +optional
	debugLogs bool,
	// +optional
	useConfigImage bool,
	// +optional
	// namePrefix is prepended to every test resource name, enabling parallel suite
	// runs against the same GitHub org without naming collisions.
	namePrefix string,
	// +optional
	// reportDir is a path inside the test container where Jest writes report.json.
	reportDir string,
) (*dagger.Container, error) {
	crdUpgradeBaselineVersion, logLevel := m.configureTestRun(
		kindClusterName,
		imageTag,
		chartVersion,
		org,
		customer,
		crdUpgradeBaselineVersion,
		debugLogs,
	)

	if shouldRunOnlyCrdUpgrade(suites) {
		return m.runCrdUpgradeTests(
			ctx,
			kubeconfig,
			kindSvc,
			projectDir,
			kindClusterName,
			imageTag,
			crdUpgradeBaselineVersion,
			crdUpgradeBaselineOperatorImageTag,
			logLevel,
			useConfigImage,
			namePrefix,
		)
	}

	if shouldRunCrdUpgrade(suites) {
		_, err := m.runCrdUpgradeTests(
			ctx,
			kubeconfig,
			kindSvc,
			projectDir,
			kindClusterName,
			imageTag,
			crdUpgradeBaselineVersion,
			crdUpgradeBaselineOperatorImageTag,
			logLevel,
			useConfigImage,
			namePrefix,
		)
		if err != nil {
			return nil, err
		}
	}

	etoeContainer, err := m.prepareBootedTestContainer(
		ctx,
		kubeconfig,
		kindSvc,
		projectDir,
		kindClusterName,
		useConfigImage,
	)
	if err != nil {
		return nil, fmt.Errorf("error preparing the test container: %w", err)
	}

	normalSuites := suitesWithoutCrdUpgrade(suites)
	if normalSuites == "" {
		return etoeContainer, nil
	}

	if shouldEnableProviderSecretEncryption(normalSuites) {
		etoeContainer, err = etoeContainer.
			WithExec([]string{
				"sh",
				"-lc",
				"set -eu\n" +
					findControllerDeploymentShellScript() +
					findControllerConfigMapShellScript() +
					`if [ -n "$cm" ]; then
  kubectl -n default patch configmap "$cm" --type merge -p '{"data":{"AVOID_PROVIDER_SECRET_ENCRYPTION":null}}'
fi` + "\n" +
					`kubectl -n default set env "deployment/$dep" AVOID_PROVIDER_SECRET_ENCRYPTION-` + "\n" +
					`kubectl -n default rollout restart "deployment/$dep"` + "\n" +
					waitForControllerRolloutAndPodStabilizationShellScript(),
			}).
			Sync(ctx)
		if err != nil {
			return nil, fmt.Errorf("error enabling provider secret encryption: %w", err)
		}
	}

	if shouldRunK8sRateLimits(normalSuites) {
		var err error
		etoeContainer, err = etoeContainer.
			WithExec([]string{"kubectl", "apply", "-f", "/library/packages/k8s/dev/dummy-crds/"}).
			WithExec([]string{
				"sh",
				"-lc",
				"set -eu\n" +
					findControllerDeploymentShellScript() +
					`current="$(kubectl -n default get deployment "$dep" -o jsonpath='{range .spec.template.spec.containers[0].env[*]}{.name}={.value}{"\n"}{end}' | grep '^OPERATOR_KIND_LIST=' | cut -d= -f2- || true)"` + "\n" +
					`if [ -z "$current" ]; then
  # Check if OPERATOR_KIND_LIST is set via a ConfigMap
  cm_name="$({ kubectl -n default get deployment "$dep" -o jsonpath='{range .spec.template.spec.containers[0].envFrom[*]}{.configMapRef.name}{"\n"}{end}' 2>/dev/null || true; } | while IFS= read -r name; do
    if [ -n "$name" ]; then printf '%s' "$name"; break; fi
  done)"
  if [ -n "$cm_name" ]; then
    current="$(kubectl -n default get configmap "$cm_name" -o jsonpath='{.data.OPERATOR_KIND_LIST}' 2>/dev/null || true)"
  fi
fi` + "\n" +
					`if [ -n "$current" ]; then
  new="${current},fsdummiesa,fsdummiesb,fsdummiesc"
else
  new="fsdummiesa,fsdummiesb,fsdummiesc"
fi` + "\n" +
					`kubectl -n default set env "deployment/$dep" "OPERATOR_KIND_LIST=${new}"` + "\n" +
					waitForControllerRolloutAndPodStabilizationShellScript(),
			}).
			Sync(ctx)
		if err != nil {
			return nil, fmt.Errorf("error applying dummy CRDs for k8s-rate-limits suite: %w", err)
		}
	}

	testArgs := []string{"npm", "run", "--workspace", "packages/e2e", "test-suites", normalSuites}
	if reportDir != "" {
		testArgs = append(testArgs, "--report-dir", reportDir)
	}

	container := m.withE2EEnv(etoeContainer, crdUpgradeBaselineVersion, logLevel, namePrefix)
	if reportDir != "" {
		container = container.WithExec([]string{"mkdir", "-p", reportDir})
	}
	return container.
		WithExec(testArgs).
		Sync(ctx)
}

func (m *Etoe) configureTestRun(
	kindClusterName string,
	imageTag string,
	chartVersion string,
	org string,
	customer string,
	crdUpgradeBaselineVersion string,
	debugLogs bool,
) (string, string) {
	applyIfSet := func(value string, assign func(string)) {
		if value != "" {
			assign(value)
		}
	}

	applyIfSet(imageTag, func(value string) { m.Config.Operator.ImageTag = value })
	applyIfSet(chartVersion, func(value string) { m.Config.Operator.ChartVersion = value })
	applyIfSet(org, func(value string) { m.Config.Org = value })
	applyIfSet(customer, func(value string) { m.Config.Customer = value })
	applyIfSet(kindClusterName, func(value string) { m.Config.Cluster = value })

	if crdUpgradeBaselineVersion == "" {
		crdUpgradeBaselineVersion = "latest"
	}

	logLevel := "info"
	if debugLogs {
		logLevel = "debug"
	}

	return crdUpgradeBaselineVersion, logLevel
}

func (m *Etoe) prepareBootedTestContainer(
	ctx context.Context,
	kubeconfig *dagger.Directory,
	kindSvc *dagger.Service,
	projectDir *dagger.Directory,
	kindClusterName string,
	useConfigImage bool,
) (*dagger.Container, error) {
	kindContainer := m.BootOperator(
		ctx,
		kubeconfig,
		kindSvc,
		kindClusterName,
		useConfigImage,
	)

	return m.PrepareTestContainer(ctx, kindContainer, projectDir)
}

func (m *Etoe) withE2EEnv(
	container *dagger.Container,
	crdUpgradeBaselineVersion string,
	logLevel string,
	namePrefix string,
) *dagger.Container {
	ctn := container.
		WithWorkdir("/library").
		WithEnvVariable("E2E_ORG", m.Config.Org).
		WithEnvVariable("E2E_NAMESPACE", "default").
		WithEnvVariable("E2E_KUBECONFIG", "/root/.kube").
		WithEnvVariable(
			"E2E_CRD_UPGRADE_BASELINE_VERSION",
			crdUpgradeBaselineVersion,
		).
		WithEnvVariable("LOG_LEVEL", logLevel)

	if namePrefix != "" {
		ctn = ctn.WithEnvVariable("E2E_NAME_PREFIX", namePrefix)
	}

	// Upstream PrepareOperator returns a secret-free container. Credentials for
	// test execution are attached only here, never to the operator install graph.
	if m.GithubAppID != nil {
		ctn = ctn.WithSecretVariable("GITHUB_APP_ID", m.GithubAppID)
	}
	if m.GithubAppPemFile != nil {
		ctn = ctn.WithSecretVariable("GITHUB_APP_PEM_FILE", m.GithubAppPemFile)
	}
	if m.PrefappBotPAT != nil {
		ctn = ctn.WithSecretVariable("PREFAPP_BOT_PAT", m.PrefappBotPAT)
	}

	return ctn
}

func (m *Etoe) runCrdUpgradePhase(
	ctx context.Context,
	container *dagger.Container,
	phase string,
	crdUpgradeBaselineVersion string,
	logLevel string,
	namePrefix string,
) (*dagger.Container, error) {
	return m.withE2EEnv(container, crdUpgradeBaselineVersion, logLevel, namePrefix).
		WithEnvVariable("E2E_CRD_UPGRADE_PHASE", phase).
		WithExec([]string{"npm", "run", "--workspace", "packages/e2e", "test-crd-upgrade"}).
		Sync(ctx)
}

func (m *Etoe) runCrdUpgradeTests(
	ctx context.Context,
	kubeconfig *dagger.Directory,
	kindSvc *dagger.Service,
	projectDir *dagger.Directory,
	kindClusterName string,
	targetImageTag string,
	crdUpgradeBaselineVersion string,
	crdUpgradeBaselineOperatorImageTag string,
	logLevel string,
	useConfigImage bool,
	namePrefix string,
) (*dagger.Container, error) {
	if targetImageTag == "" {
		targetImageTag = m.Config.Operator.ImageTag
	}

	baselineImageTag := strings.TrimSpace(crdUpgradeBaselineOperatorImageTag)
	if baselineImageTag == "" {
		return nil, fmt.Errorf("--crd-upgrade-baseline-operator-image-tag (or E2E_CRD_UPGRADE_BASELINE_OPERATOR_IMAGE_TAG in the workflow) is required when --suites includes all, crd-upgrade, or org-script-crd-upgrade")
	}

	baselineCrdKindContainer, err := m.prepareKindBridgeContainer(
		ctx,
		kubeconfig,
		kindSvc,
		kindClusterName,
	)
	if err != nil {
		return nil, fmt.Errorf("error preparing baseline CRD bridge container: %w", err)
	}

	baselineCrdContainer, err := m.prepareCrdUpgradeTestContainer(
		ctx,
		baselineCrdKindContainer,
		projectDir,
		"baseline CRD",
	)
	if err != nil {
		return nil, err
	}

	_, err = m.runNamedCrdUpgradePhase(
		ctx,
		baselineCrdContainer,
		"baseline-crds",
		crdUpgradeBaselineVersion,
		logLevel,
		namePrefix,
		"applying baseline CRDs",
	)
	if err != nil {
		return nil, err
	}

	baselineSupportedKinds := ""
	if kinds, ok := legacyBaselineCapabilities(baselineImageTag); ok {
		baselineSupportedKinds = strings.Join(kinds, " ")
	}

	m.Config.Operator.ImageTag = baselineImageTag
	kindContainer := m.bootOperator(
		ctx,
		kubeconfig,
		kindSvc,
		kindClusterName,
		useConfigImage,
		baselineSupportedKinds,
	)

	etoeContainer, err := m.prepareCrdUpgradeTestContainer(ctx, kindContainer, projectDir, "baseline resource")
	if err != nil {
		return nil, err
	}

	etoeContainer, err = m.runNamedCrdUpgradePhase(
		ctx,
		etoeContainer,
		"baseline-create",
		crdUpgradeBaselineVersion,
		logLevel,
		namePrefix,
		"creating baseline resources",
	)
	if err != nil {
		return nil, err
	}

	etoeContainer, err = m.runNamedCrdUpgradePhase(
		ctx,
		etoeContainer,
		"target-crds",
		crdUpgradeBaselineVersion,
		logLevel,
		namePrefix,
		"applying target CRDs",
	)
	if err != nil {
		return nil, err
	}

	m.Config.Operator.ImageTag = targetImageTag
	etoeContainer = m.upgradeOperatorImage(etoeContainer, targetImageTag, useConfigImage, true)

	return m.runNamedCrdUpgradePhase(
		ctx,
		etoeContainer,
		"target-validate",
		crdUpgradeBaselineVersion,
		logLevel,
		namePrefix,
		"validating target resources",
	)
}

func (m *Etoe) prepareCrdUpgradeTestContainer(
	ctx context.Context,
	kindContainer *dagger.Container,
	projectDir *dagger.Directory,
	purpose string,
) (*dagger.Container, error) {
	container, err := m.PrepareTestContainer(ctx, kindContainer, projectDir)
	if err != nil {
		return nil, fmt.Errorf("error preparing %s test container: %w", purpose, err)
	}

	return container, nil
}

func (m *Etoe) runNamedCrdUpgradePhase(
	ctx context.Context,
	container *dagger.Container,
	phase string,
	crdUpgradeBaselineVersion string,
	logLevel string,
	namePrefix string,
	failureAction string,
) (*dagger.Container, error) {
	container, err := m.runCrdUpgradePhase(ctx, container, phase, crdUpgradeBaselineVersion, logLevel, namePrefix)
	if err != nil {
		return nil, fmt.Errorf("error %s: %w", failureAction, err)
	}

	return container, nil
}

func operatorImagePullPolicy(useConfigImage bool) string {
	if useConfigImage {
		return "IfNotPresent"
	}
	return "Never"
}

func (m *Etoe) UpgradeOperatorImage(
	container *dagger.Container,
	targetImageTag string,
	useConfigImage bool,
) *dagger.Container {
	return m.upgradeOperatorImage(container, targetImageTag, useConfigImage, false)
}

func (m *Etoe) upgradeOperatorImage(
	container *dagger.Container,
	targetImageTag string,
	useConfigImage bool,
	restoreTargetKinds bool,
) *dagger.Container {
	pullPolicy := operatorImagePullPolicy(useConfigImage)

	upgradeScript := operatorUpgradeShellScript(restoreTargetKinds)

	return container.
		WithEnvVariable("FIRESTARTR_TARGET_IMAGE", fmt.Sprintf("ghcr.io/firestartr-pro/firestartr:%s", targetImageTag)).
		WithEnvVariable("FIRESTARTR_TARGET_PULL_POLICY", pullPolicy).
		WithExec([]string{
			"sh",
			"-lc",
			"set -eu\n" +
				findControllerDeploymentShellScript() +
				`container_name="$(kubectl -n default get deployment "$dep" -o jsonpath='{.spec.template.spec.containers[0].name}')"` + "\n" +
				upgradeScript +
				waitForControllerRolloutAndPodStabilizationShellScript(),
		})
}

func (m *Etoe) CmdTerminalTests(
	ctx context.Context,
	kubeconfig *dagger.Directory,
	kindSvc *dagger.Service,
	kindClusterName string,
	projectDir *dagger.Directory,
	// +optional
	useConfigImage bool,
) (*dagger.Container, error) {

	kindContainer := m.BootOperator(
		ctx,
		kubeconfig,
		kindSvc,
		kindClusterName,
		useConfigImage,
	)

	etoeContainer, err := m.PrepareTestContainer(
		ctx,
		kindContainer,
		projectDir,
	)

	if err != nil {
		return nil, fmt.Errorf("error preparing the test container: %w", err)
	}

	return m.withE2EEnv(etoeContainer, "latest", "info", ""), nil
}

func (m *Etoe) CmdLaunchDevPod(
	ctx context.Context,
	kubeconfig *dagger.Directory,
	kindSvc *dagger.Service,
	kindClusterName string,
	image string,
	devDirectory string,
) *dagger.Container {

	container := dag.FirestartrCore().LaunchDevPod(
		kubeconfig,
		kindSvc,
		kindClusterName,
		image,
		devDirectory,
	)

	ctn, err := container.
		WithExec([]string{"kubectl", "apply", "-f", "/home/pod.yaml"}).
		Sync(ctx)

	if err != nil {
		panic(fmt.Sprintf("Error launching dev pod: %v", err))
	}

	return ctn
}

func (m *Etoe) CmdLaunchDevShell(
	ctx context.Context,
	kubeconfig *dagger.Directory,
	kindSvc *dagger.Service,
	kindClusterName string,
	// +optional
	imageTag string,
) (*dagger.Container, error) {
	if imageTag == "" {
		imageTag = m.Config.Operator.ImageTag
	}
	if imageTag == "" {
		imageTag = "latest"
	}
	image := "ghcr.io/firestartr-pro/firestartr:" + imageTag

	bridge, err := m.prepareKindBridgeContainer(ctx, kubeconfig, kindSvc, kindClusterName)
	if err != nil {
		return nil, fmt.Errorf("error preparing bridge container: %w", err)
	}

	// Discover the operator's ServiceAccount and secret dynamically from the
	// running deployment so the dev pod shares the same RBAC and credentials.
	discoverScript := `set -eu
E2E_ORG="` + m.Config.Org + `"
dep=""
for _ in $(seq 1 30); do
  dep="$(kubectl -n default get deploy -o jsonpath='{range .items[*]}{.metadata.name}{" "}{.spec.template.metadata.labels.app}{" "}{.spec.template.metadata.labels.concern}{"\n"}{end}' 2>/dev/null | while IFS=' ' read -r name app concern; do
    if [ "$app" = "firestartr-controller" ] && [ "$concern" = "controller" ]; then
      printf '%s' "$name"
      break
    fi
  done)"
  if [ -n "$dep" ]; then break; fi
  sleep 1
done
if [ -z "$dep" ]; then
  echo "ERROR: firestartr controller deployment not found" >&2
  exit 1
fi

sa="$(kubectl -n default get deployment "$dep" -o jsonpath='{.spec.template.spec.serviceAccountName}' 2>/dev/null || true)"
if [ -z "$sa" ]; then sa="default"; fi

secret="$(kubectl -n default get deployment "$dep" -o jsonpath='{range .spec.template.spec.containers[0].envFrom[*]}{.secretRef.name}{"\n"}{end}' 2>/dev/null | while IFS= read -r name; do
  if [ -n "$name" ]; then printf '%s' "$name"; break; fi
done)"
if [ -z "$secret" ]; then
  echo "ERROR: no Secret found in envFrom on deployment ${dep}" >&2
  exit 1
fi

	cat > /tmp/e2e-dev-pod.yaml <<PODEOF
apiVersion: v1
kind: Pod
metadata:
  name: e2e-dev
  namespace: default
  labels:
    app: e2e-dev
spec:
  serviceAccountName: ${sa}
  containers:
  - name: e2e-dev
    image: ` + image + `
    imagePullPolicy: Never
    command: ["tail", "-f", "/dev/null"]
    workingDir: /library
    env:
    - name: E2E_ORG
      value: "${E2E_ORG}"
    - name: E2E_NAMESPACE
      value: "default"
    envFrom:
    - secretRef:
        name: ${secret}
    volumeMounts:
    - name: development
      mountPath: /library
  volumes:
  - name: development
    hostPath:
      path: /development
      type: Directory
PODEOF

kubectl apply -f /tmp/e2e-dev-pod.yaml
`

	ctn, err := bridge.
		WithExec([]string{"sh", "-c", discoverScript}).
		Sync(ctx)
	if err != nil {
		return nil, fmt.Errorf("error launching e2e dev pod: %w", err)
	}

	return ctn, nil
}

// CmdBootOperator boots the operator in the Kind cluster without running tests.
// Use this to set up the full operator release (CRDs, chart, deployment) and then
// launch a dev pod for interactive debugging.
func (m *Etoe) CmdBootOperator(
	ctx context.Context,
	kubeconfig *dagger.Directory,
	kindSvc *dagger.Service,
	kindClusterName string,
	// +optional
	imageTag string,
	// +optional
	chartVersion string,
	// +optional
	useConfigImage bool,
) (*dagger.Container, error) {
	if imageTag != "" {
		m.Config.Operator.ImageTag = imageTag
	}
	if chartVersion != "" {
		m.Config.Operator.ChartVersion = chartVersion
	}

	kindContainer := m.BootOperator(
		ctx,
		kubeconfig,
		kindSvc,
		kindClusterName,
		useConfigImage,
	)

	return kindContainer, nil
}

func (m *Etoe) BootOperator(
	ctx context.Context,
	kubeconfig *dagger.Directory,
	kindSvc *dagger.Service,
	kindClusterName string,
	useConfigImage bool,
) *dagger.Container {
	return m.bootOperator(ctx, kubeconfig, kindSvc, kindClusterName, useConfigImage, "")
}

func (m *Etoe) bootOperator(
	ctx context.Context,
	kubeconfig *dagger.Directory,
	kindSvc *dagger.Service,
	kindClusterName string,
	useConfigImage bool,
	baselineSupportedKinds string,
) *dagger.Container {
	pullPolicy := operatorImagePullPolicy(useConfigImage)

	fConfig := dag.FirestartrCore().GetConfig(
		kindClusterName,
		m.Config.Org,
		m.Config.Customer,
		// operator configuration
		m.Config.Operator.ChartVersion,
		m.Config.Operator.ImageName,
		m.Config.Operator.ImageTag,
		// credentials
		m.Config.Credentials.Region,
		pullPolicy,
		false, // Let's avoid installing the crds
	)

	maxSlots := m.Config.Operator.MaxSlots
	if maxSlots == "" {
		maxSlots = "1"
	}

	container := dag.FirestartrCore().PrepareOperator(
		kubeconfig,
		kindSvc,
		fConfig,
		m.AWSAccessKey,
		m.AWSSecretAccessKey,
		m.AWSSessionToken,
	).
		WithEnvVariable("FIRESTARTR_E2E_ORG", m.Config.Org).
		WithEnvVariable("FIRESTARTR_BASELINE_KINDS", baselineSupportedKinds).
		WithEnvVariable("FIRESTARTR_MAX_SLOTS", maxSlots).
		WithExec([]string{
			"sh",
			"-lc",
			bootOperatorShellScript(),
		})

	return container
}

func findControllerConfigMapShellScript() string {
	return `cm="$({ kubectl -n default get deployment "$dep" -o jsonpath='{range .spec.template.spec.containers[0].envFrom[*]}{.configMapRef.name}{"\n"}{end}' 2>/dev/null || true; } | while IFS= read -r name; do
  if [ -n "$name" ]; then
    printf '%s' "$name"
    break
  fi
done)"
`
}

// findControllerDeploymentShellScript returns a shell script fragment that locates the
// firestartr-controller deployment by labels (app=firestartr-controller, concern=controller).
// Sets the $dep variable or exits with an error if not found.
func findControllerDeploymentShellScript() string {
	return `dep=""
for _ in $(seq 1 120); do
	dep="$({ kubectl -n default get deploy -o jsonpath='{range .items[*]}{.metadata.name}{" "}{.spec.template.metadata.labels.app}{" "}{.spec.template.metadata.labels.concern}{"\n"}{end}' 2>/dev/null || true; } | while IFS=' ' read -r name app concern; do
  if [ "$app" = "firestartr-controller" ] && [ "$concern" = "controller" ]; then
    printf '%s' "$name"
    break
  fi
done)"
  if [ -n "$dep" ]; then
    break
  fi
  sleep 1
done
if [ -z "$dep" ]; then
  kubectl get deploy -A >&2 || true
  echo "firestartr controller deployment not found" >&2
  exit 1
fi
`
}

// waitForControllerRolloutAndPodStabilizationShellScript returns a shell script fragment that:
//  1. Waits for kubectl rollout status to complete.
//  2. Verifies pod stabilization: all desired replicas are non-terminating and ready,
//     with no pods in terminating state.
//
// This ensures old pods have fully cleaned up after a deployment update,
// preventing false positives from rollout status alone.
func waitForControllerRolloutAndPodStabilizationShellScript() string {
	return `if ! kubectl -n default rollout status "deployment/$dep" --timeout=120s; then
		kubectl -n default get deployment "$dep" -o yaml >&2 || true
		kubectl -n default get rs,pods -l app=firestartr-controller,concern=controller -o wide >&2 || true
		kubectl -n default describe deployment "$dep" >&2 || true
	for pod in $(kubectl -n default get pods -l app=firestartr-controller,concern=controller -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' 2>/dev/null || true); do
		kubectl -n default describe pod "$pod" >&2 || true
		kubectl -n default logs "$pod" --previous >&2 || true
		done
		kubectl -n default get events --sort-by=.lastTimestamp >&2 || true
		echo "firestartr controller rollout timed out" >&2
		exit 1
	fi
desired_replicas="$(kubectl -n default get deployment "$dep" -o jsonpath='{.spec.replicas}' 2>/dev/null || true)"
if [ -z "$desired_replicas" ]; then
	desired_replicas=1
fi
stabilization_timeout_seconds=120
debug_file="/tmp/controller-stabilization-debug.txt"
debug_pod_dir="/tmp/controller-stabilization-debug-pods"
mkdir -p "$debug_pod_dir"
non_terminating=0
ready_non_terminating=0
terminating=0
for elapsed in $(seq 1 "$stabilization_timeout_seconds"); do
	status_lines="$(kubectl -n default get pods -l app=firestartr-controller,concern=controller -o jsonpath='{range .items[*]}{.metadata.name}{"|"}{.metadata.deletionTimestamp}{"|"}{range .status.conditions[?(@.type=="Ready")]}{.status}{end}{"\n"}{end}' 2>/dev/null || true)"
	non_terminating=0
	ready_non_terminating=0
	terminating=0
	while IFS='|' read -r pod deletion ready; do
		if [ -z "$pod" ]; then
			continue
		fi
		if [ -n "$deletion" ] && [ "$deletion" != "<no value>" ]; then
			terminating=$((terminating + 1))
			continue
		fi
		non_terminating=$((non_terminating + 1))
		if [ "$ready" = "True" ]; then
			ready_non_terminating=$((ready_non_terminating + 1))
		fi
	done <<EOF
$status_lines
EOF
	if [ "$non_terminating" -eq "$desired_replicas" ] && [ "$ready_non_terminating" -eq "$desired_replicas" ] && [ "$terminating" -eq 0 ]; then
		break
	fi
	echo "Waiting for controller pod stabilization: elapsed=${elapsed}s desired_replicas=$desired_replicas non_terminating=$non_terminating ready_non_terminating=$ready_non_terminating terminating=$terminating" >&2
	sleep 1
done
if [ "$non_terminating" -ne "$desired_replicas" ] || [ "$ready_non_terminating" -ne "$desired_replicas" ] || [ "$terminating" -ne 0 ]; then
	{
		echo "controller stabilization timeout"
		echo "elapsed_seconds=$stabilization_timeout_seconds"
		echo "deployment=$dep"
		echo "desired_replicas=$desired_replicas"
		echo "non_terminating=$non_terminating"
		echo "ready_non_terminating=$ready_non_terminating"
		echo "terminating=$terminating"
		echo
		echo "deployment yaml"
		kubectl -n default get deployment "$dep" -o yaml 2>/dev/null || true
		echo
		echo "replicasets"
		kubectl -n default get rs -l app=firestartr-controller,concern=controller -o wide 2>/dev/null || true
		echo
		echo "pods"
		kubectl -n default get pods -l app=firestartr-controller,concern=controller -o wide 2>/dev/null || true
		echo
		echo "pod descriptions"
		for pod in $(kubectl -n default get pods -l app=firestartr-controller,concern=controller -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' 2>/dev/null || true); do
			echo "--- $pod"
			kubectl -n default describe pod "$pod" 2>/dev/null || true
			pod_log_file="$debug_pod_dir/$pod.log"
			kubectl -n default logs "$pod" > "$pod_log_file" 2>/dev/null || true
			if [ ! -s "$pod_log_file" ]; then
				kubectl -n default logs "$pod" --previous > "$pod_log_file" 2>/dev/null || true
			fi
			if [ -s "$pod_log_file" ]; then
				echo
				echo "logs for $pod"
				cat "$pod_log_file"
			fi
		done
		echo
		echo "events"
		kubectl -n default get events --sort-by=.lastTimestamp 2>/dev/null || true
	} > "$debug_file"
	echo "controller stabilization timeout; full debug dump written to $debug_file" >&2
	cat "$debug_file" >&2
	echo "firestartr controller pods did not stabilize" >&2
	exit 1
fi
`
}
