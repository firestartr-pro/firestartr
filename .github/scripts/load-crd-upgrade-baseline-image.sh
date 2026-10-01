#!/usr/bin/env bash
set -euo pipefail

# Loads the CRD-upgrade baseline operator image into the current Kind cluster.
#
# Required environment variables:
#   BASELINE_VERSION       — requested baseline version, or latest.
#   E2E_IMAGE_PLATFORM     — platform to resolve and load, e.g. linux/amd64.
#   E2E_KIND_CLUSTER_NAME  — Kind cluster name.
#   GHCR_TOKEN             — GHCR read token.
#   GHCR_USERNAME          — GHCR username.
#   GITHUB_ENV             — GitHub Actions environment file.
#   GITHUB_STEP_SUMMARY    — GitHub Actions step summary file.
#
# Optional environment variables:
#   PROJECT_DIR             — checked-out repository path (default: project-dir).

project_dir="${PROJECT_DIR:-project-dir}"
baseline_operator_version="$(printf '%s' "${BASELINE_VERSION}" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
normalized_baseline_operator_version="$(printf '%s' "${baseline_operator_version}" | tr '[:upper:]' '[:lower:]')"
if [ -z "${baseline_operator_version}" ] || [ "${normalized_baseline_operator_version}" = "latest" ]; then
  baseline_operator_version="$(jq -r '."." // empty' "${project_dir}/.release-please-manifest.json")"
  if [ -z "${baseline_operator_version}" ]; then
    echo '.release-please-manifest.json field "." is required to resolve latest CRD baseline to an operator image version'
    exit 1
  fi
fi

case "${baseline_operator_version}" in
  v*) ;;
  *) baseline_operator_version="v${baseline_operator_version}" ;;
esac

baseline_operator_image_tag="${baseline_operator_version}_full-aws"
baseline_image="ghcr.io/firestartr-pro/firestartr:${baseline_operator_image_tag}"
echo "E2E_CRD_UPGRADE_BASELINE_OPERATOR_IMAGE_TAG=${baseline_operator_image_tag}" >> "${GITHUB_ENV}"
echo "Loading CRD upgrade baseline image ${baseline_image} for ${E2E_IMAGE_PLATFORM}"
printf '%s' "${GHCR_TOKEN}" | docker login ghcr.io -u "${GHCR_USERNAME}" --password-stdin

manifest_file="$(mktemp)"
trap 'rm -f "${manifest_file}"' EXIT
if ! docker manifest inspect --verbose "${baseline_image}" > "${manifest_file}"; then
  echo "Unable to inspect baseline image manifest for ${baseline_image}" >&2
  exit 1
fi

platform_os="${E2E_IMAGE_PLATFORM%%/*}"
platform_architecture="${E2E_IMAGE_PLATFORM#*/}"
manifest_descriptors="$(jq -r --arg platform_os "${platform_os}" --arg platform_architecture "${platform_architecture}" '
  def is_digest:
    type == "string" and test("^sha256:[0-9a-f]{64}$");
  def descriptor:
    (.OCIManifest.config.digest // .SchemaV2Manifest.config.digest) as $config_digest
    | select(.Descriptor.digest | is_digest)
    | select($config_digest | is_digest)
    | [.Descriptor.digest, $config_digest]
    | @tsv;
  if type == "array" then
    [
      .[]
      | select(.Descriptor.platform.os == $platform_os and .Descriptor.platform.architecture == $platform_architecture)
      | descriptor
    ]
    | unique
    | .[]
  elif .Descriptor.platform == null then
    descriptor
  elif .Descriptor.platform.os == $platform_os and .Descriptor.platform.architecture == $platform_architecture then
    descriptor
  else
    empty
  end
' "${manifest_file}" | sort -u)"
manifest_descriptor_count="$(printf '%s\n' "${manifest_descriptors}" | sed '/^$/d' | wc -l | tr -d ' ')"
if [ "${manifest_descriptor_count}" -ne 1 ]; then
  manifest_platforms="$(jq -r '
    (if type == "array" then .[] else . end)
    | select(.Descriptor.platform.os? and .Descriptor.platform.architecture?)
    | "\(.Descriptor.platform.os)/\(.Descriptor.platform.architecture)"
  ' "${manifest_file}" | sort -u | paste -sd, -)"
  manifest_has_linux_amd64="false"
  if printf '%s\n' "${manifest_platforms}" | tr ',' '\n' | grep -Fxq "${E2E_IMAGE_PLATFORM}"; then
    manifest_has_linux_amd64="true"
  fi
  if [ "${manifest_has_linux_amd64}" = "true" ]; then
    echo "Baseline image ${baseline_image} publishes linux/amd64 but its manifest is missing a usable config digest; classify this as an invalid artifact" >&2
  elif [ -n "${manifest_platforms}" ]; then
    echo "Baseline image ${baseline_image} publishes ${manifest_platforms}, not ${E2E_IMAGE_PLATFORM}; classify this as a wrong-platform artifact" >&2
  else
    echo "Baseline image ${baseline_image} has no usable image descriptor; classify this as an invalid artifact" >&2
  fi
  exit 1
fi
baseline_manifest_digest="$(printf '%s\n' "${manifest_descriptors}" | cut -f1)"
baseline_config_digest="$(printf '%s\n' "${manifest_descriptors}" | cut -f2)"

docker pull --platform "${E2E_IMAGE_PLATFORM}" "${baseline_image}"
local_os="$(docker image inspect --format '{{.Os}}' "${baseline_image}")"
local_architecture="$(docker image inspect --format '{{.Architecture}}' "${baseline_image}")"
local_image_id="$(docker image inspect --format '{{.Id}}' "${baseline_image}")"

if [ "${local_os}/${local_architecture}" != "${E2E_IMAGE_PLATFORM}" ]; then
  echo "Baseline image ${baseline_image} resolved to ${local_os}/${local_architecture}, expected ${E2E_IMAGE_PLATFORM}; classify this as a wrong-platform artifact" >&2
  exit 1
fi
if [ "${local_image_id}" != "${baseline_config_digest}" ]; then
  echo "Baseline image ${baseline_image} changed between manifest inspection and pull; expected config digest ${baseline_config_digest}, got image ID ${local_image_id}" >&2
  exit 1
fi

if ! docker run --rm --platform "${E2E_IMAGE_PLATFORM}" --entrypoint /usr/local/bin/node "${baseline_image}" --version >/dev/null 2>&1; then
  echo "Baseline image ${baseline_image} is linux/amd64 but failed the executable smoke check; classify this as a broken same-platform artifact" >&2
  exit 1
fi

echo "E2E_CRD_UPGRADE_BASELINE_OPERATOR_IMAGE_DIGEST=${baseline_manifest_digest}" >> "${GITHUB_ENV}"
{
  echo "### CRD upgrade baseline image"
  echo "- reference: \`${baseline_image}\`"
  echo "- platform: \`${E2E_IMAGE_PLATFORM}\`"
  echo "- manifest digest: \`${baseline_manifest_digest}\`"
  echo "- image ID: \`${local_image_id}\`"
  echo "- executable smoke check: passed"
} >> "${GITHUB_STEP_SUMMARY}"

kind load docker-image "${baseline_image}" --name "${E2E_KIND_CLUSTER_NAME}"
