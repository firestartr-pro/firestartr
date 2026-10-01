#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$ROOT/.github/scripts/promote-public-docs.sh"
WORKFLOW="$ROOT/.github/workflows/promote_docs.yaml"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_file() {
  [ -f "$1" ] || fail "expected file: $1"
}

assert_absent() {
  [ ! -e "$1" ] || fail "expected absent: $1"
}

assert_contains() {
  grep -Fq "$2" "$1" || fail "expected '$2' in $1"
}

assert_not_contains() {
  if grep -Fq "$2" "$1"; then
    fail "did not expect '$2' in $1"
  fi
}

[ -f "$SCRIPT" ] || fail "missing $SCRIPT"
[ -x "$SCRIPT" ] || fail "script is not executable: $SCRIPT"

grep -Fq 'promote-public-docs.sh' "$WORKFLOW" || fail "workflow does not invoke promote-public-docs.sh"
if grep -Fq 'rm -rf "${pro_docs_docs_path}"' "$WORKFLOW"; then
  fail "workflow still wipes entire dest docs"
fi

WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/promote-public-docs.XXXXXX")"
trap 'rm -rf "$WORKDIR"' EXIT

SOURCE_PUBLIC="$WORKDIR/source/docs/public"
DEST_ROOT="$WORKDIR/dest"

mkdir -p \
  "$SOURCE_PUBLIC/providers/terraform" \
  "$SOURCE_PUBLIC/images" \
  "$DEST_ROOT/site/raw/core/docs/backstage" \
  "$DEST_ROOT/site/raw/core/docs/providers/terraform" \
  "$DEST_ROOT/site/raw/images"

cat > "$SOURCE_PUBLIC/README.md" << 'EOF'
# GitOps docs
![Keep](./images/keep.png)
![Nested](./images/subdir/nested.png)
![Bare](images/bare.png)
![Absolute](/docs/images/absolute.png)
![Url](https://example.com/images/remote.png)
![Tricky](foo-images/tricky.png)
![Empty](./images/)
EOF

cat > "$SOURCE_PUBLIC/keep-page.md" << 'EOF'
# Keep page
EOF

cat > "$SOURCE_PUBLIC/providers/terraform/README.md" << 'EOF'
# Terraform
![Up](../images/up.png)
EOF

printf 'new-keep' > "$SOURCE_PUBLIC/images/keep.png"
printf 'new-nested' > "$SOURCE_PUBLIC/images/nested.png"

cat > "$DEST_ROOT/site/raw/core/docs/README.md" << 'EOF'
# old gitops readme
![Old](./images/keep.png)
EOF

echo '# keep old' > "$DEST_ROOT/site/raw/core/docs/keep-page.md"
echo '# stale gitops page' > "$DEST_ROOT/site/raw/core/docs/stale-page.md"
echo '# dest-only nested' > "$DEST_ROOT/site/raw/core/docs/providers/terraform/gone.md"
echo '# old terraform' > "$DEST_ROOT/site/raw/core/docs/providers/terraform/README.md"

cat > "$DEST_ROOT/site/raw/core/docs/backstage/README.md" << 'EOF'
# Firestartr Portal
![Portal](/docs/images/backstage-features-control-03-configure-feature.png)
![Relative](./images/should-not-rewrite.png)
EOF

echo '# backstage guide' > "$DEST_ROOT/site/raw/core/docs/backstage/guide.md"

printf 'old-keep' > "$DEST_ROOT/site/raw/images/core-keep.png"
printf 'stale-core' > "$DEST_ROOT/site/raw/images/core-stale.png"
printf 'backstage-img' > "$DEST_ROOT/site/raw/images/backstage-features-control-03-configure-feature.png"
printf 'feature-img' > "$DEST_ROOT/site/raw/images/claims_repo-example_1-1.jpg"
echo 'not an image' > "$DEST_ROOT/site/raw/images/core-README.md"

SOURCE_PUBLIC_DOCS="$SOURCE_PUBLIC" \
DEST_REPO_ROOT="$DEST_ROOT" \
PROMOTION_SUMMARY="$WORKDIR/summary.md" \
  bash "$SCRIPT"

DOCS="$DEST_ROOT/site/raw/core/docs"
IMAGES="$DEST_ROOT/site/raw/images"

assert_file "$DOCS/README.md"
assert_file "$DOCS/keep-page.md"
assert_file "$DOCS/providers/terraform/README.md"
assert_file "$DOCS/backstage/README.md"
assert_file "$DOCS/backstage/guide.md"
assert_absent "$DOCS/stale-page.md"
assert_absent "$DOCS/providers/terraform/gone.md"

assert_contains "$DOCS/README.md" './images/core-keep.png'
assert_contains "$DOCS/README.md" './images/core-nested.png'
assert_not_contains "$DOCS/README.md" './images/keep.png'
assert_not_contains "$DOCS/README.md" './images/subdir/nested.png'
assert_contains "$DOCS/README.md" '![Bare](images/bare.png)'
assert_contains "$DOCS/README.md" '/docs/images/absolute.png'
assert_contains "$DOCS/README.md" 'https://example.com/images/remote.png'
assert_contains "$DOCS/README.md" 'foo-images/tricky.png'
assert_contains "$DOCS/README.md" '![Empty](./images/)'
assert_not_contains "$DOCS/README.md" 'core-bare'
assert_not_contains "$DOCS/README.md" 'images/core-absolute'
assert_not_contains "$DOCS/README.md" 'images/core-remote'
assert_not_contains "$DOCS/README.md" 'foo-images/core-'
assert_contains "$DOCS/providers/terraform/README.md" '../images/core-up.png'

assert_contains "$DOCS/backstage/README.md" '/docs/images/backstage-features-control-03-configure-feature.png'
assert_contains "$DOCS/backstage/README.md" './images/should-not-rewrite.png'
assert_not_contains "$DOCS/backstage/README.md" 'images/core-'

assert_file "$IMAGES/core-keep.png"
assert_file "$IMAGES/core-nested.png"
assert_absent "$IMAGES/core-stale.png"
assert_file "$IMAGES/backstage-features-control-03-configure-feature.png"
assert_file "$IMAGES/claims_repo-example_1-1.jpg"
assert_file "$IMAGES/core-README.md"

[ "$(cat "$IMAGES/core-keep.png")" = 'new-keep' ] || fail "core-keep.png was not replaced from source"
[ "$(cat "$DOCS/backstage/guide.md")" = '# backstage guide' ] || fail "backstage guide was modified"
[ "$(cat "$IMAGES/backstage-features-control-03-configure-feature.png")" = 'backstage-img' ] || fail "backstage image was modified"
[ "$(cat "$IMAGES/claims_repo-example_1-1.jpg")" = 'feature-img' ] || fail "feature image was modified"
[ "$(cat "$IMAGES/core-README.md")" = 'not an image' ] || fail "non-image core-* leftover was deleted"

# A source tree without images/ must not wipe already published core-* assets.
NO_IMAGES_SOURCE="$WORKDIR/source-no-images/docs/public"
NO_IMAGES_DEST="$WORKDIR/dest-no-images"

mkdir -p \
  "$NO_IMAGES_SOURCE" \
  "$NO_IMAGES_DEST/site/raw/core/docs" \
  "$NO_IMAGES_DEST/site/raw/images"

echo '# page without images' > "$NO_IMAGES_SOURCE/README.md"
printf 'published-core' > "$NO_IMAGES_DEST/site/raw/images/core-published.png"
printf 'backstage-img' > "$NO_IMAGES_DEST/site/raw/images/backstage-features-control-03-configure-feature.png"

SOURCE_PUBLIC_DOCS="$NO_IMAGES_SOURCE" \
DEST_REPO_ROOT="$NO_IMAGES_DEST" \
  bash "$SCRIPT"

assert_file "$NO_IMAGES_DEST/site/raw/core/docs/README.md"
assert_file "$NO_IMAGES_DEST/site/raw/images/core-published.png"
assert_file "$NO_IMAGES_DEST/site/raw/images/backstage-features-control-03-configure-feature.png"
[ "$(cat "$NO_IMAGES_DEST/site/raw/images/core-published.png")" = 'published-core' ] || fail "core-* image wiped when source images/ is missing"
[ "$(cat "$NO_IMAGES_DEST/site/raw/images/backstage-features-control-03-configure-feature.png")" = 'backstage-img' ] || fail "backstage image not preserved when source images/ is missing"

echo "OK"
