#!/usr/bin/env bash
set -euo pipefail

if [ -z "${SOURCE_PUBLIC_DOCS:-}" ] && [ -n "${GITHUB_WORKSPACE:-}" ]; then
  SOURCE_PUBLIC_DOCS="$GITHUB_WORKSPACE/gitops/docs/public"
fi
if [ -z "${DEST_REPO_ROOT:-}" ] && [ -n "${GITHUB_WORKSPACE:-}" ]; then
  DEST_REPO_ROOT="$GITHUB_WORKSPACE/pro-docs"
fi

if [ -z "${SOURCE_PUBLIC_DOCS:-}" ] || [ -z "${DEST_REPO_ROOT:-}" ]; then
  echo "SOURCE_PUBLIC_DOCS and DEST_REPO_ROOT are required" >&2
  exit 1
fi

dest_docs="$DEST_REPO_ROOT/site/raw/core/docs"
dest_images="$DEST_REPO_ROOT/site/raw/images"

append_summary() {
  if [ -n "${PROMOTION_SUMMARY:-}" ]; then
    echo "$1" >> "$PROMOTION_SUMMARY"
  fi
}

is_image_name() {
  case "$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')" in
    *.png|*.jpg|*.jpeg|*.gif|*.svg|*.webp) return 0 ;;
    *) return 1 ;;
  esac
}

rewrite_gitops_image_refs() {
  local md_file="$1"
  local tmp
  tmp="$(mktemp)"
  sed -E 's#((\.\./)+|\./)images/([^)]*/)?([^)/]+)#\1images/core-\4#g' "$md_file" > "$tmp"
  mv "$tmp" "$md_file"
}

rel_from_public() {
  local path="$1"
  local rel="${path#$SOURCE_PUBLIC_DOCS}"
  rel="${rel#/}"
  printf '%s' "$rel"
}

is_backstage_rel() {
  case "$1" in
    backstage|backstage/*) return 0 ;;
    *) return 1 ;;
  esac
}

if [ ! -d "$SOURCE_PUBLIC_DOCS" ]; then
  echo "Public documentation not found ($SOURCE_PUBLIC_DOCS), skipped"
  append_summary "⚠️ **Public Documentation**: Not found (${SOURCE_PUBLIC_DOCS} does not exist), skipped"
  exit 0
fi

backstage_tmp=""
if [ -d "$dest_docs/backstage" ]; then
  backstage_tmp="$(mktemp -d)"
  mv "$dest_docs/backstage" "$backstage_tmp/backstage"
fi
rm -rf "$dest_docs"
mkdir -p "$dest_docs"
if [ -n "$backstage_tmp" ]; then
  mv "$backstage_tmp/backstage" "$dest_docs/backstage"
  rmdir "$backstage_tmp"
fi

find "$SOURCE_PUBLIC_DOCS" -type d ! \( -path "$SOURCE_PUBLIC_DOCS/images" -o -path "$SOURCE_PUBLIC_DOCS/images/*" \) -print0 |
while IFS= read -r -d '' dir; do
  rel="$(rel_from_public "$dir")"
  [ -n "$rel" ] || continue
  is_backstage_rel "$rel" && continue
  mkdir -p "$dest_docs/$rel"
done

find "$SOURCE_PUBLIC_DOCS" -type f -name '*.md' ! \( -path "$SOURCE_PUBLIC_DOCS/images" -o -path "$SOURCE_PUBLIC_DOCS/images/*" \) -print0 |
while IFS= read -r -d '' md_file; do
  rel="$(rel_from_public "$md_file")"
  is_backstage_rel "$rel" && continue
  mkdir -p "$(dirname "$dest_docs/$rel")"
  cp "$md_file" "$dest_docs/$rel"
  echo "  Copied $rel"
done

append_summary "✓ **Public Documentation**: Copied to \`${DEST_REPO_ROOT}/site/raw/core/docs/\`"

mkdir -p "$dest_images"
copied_list="$(mktemp)"

if [ -d "$SOURCE_PUBLIC_DOCS/images" ]; then
  find "$SOURCE_PUBLIC_DOCS/images" -type f \
    \( -iname '*.png' -o -iname '*.jpg' -o -iname '*.jpeg' \
    -o -iname '*.gif' -o -iname '*.svg' -o -iname '*.webp' \) \
    -print0 |
  while IFS= read -r -d '' img; do
    img_name="$(basename "$img")"
    cp "$img" "$dest_images/core-${img_name}"
    echo "core-${img_name}" >> "$copied_list"
    echo "  Copied image: core-${img_name}"
  done

  find "$dest_docs" -type f -name '*.md' ! -path "$dest_docs/backstage/*" -print0 |
  while IFS= read -r -d '' md_file; do
    rewrite_gitops_image_refs "$md_file"
    echo "  Updated image references in $(basename "$md_file")"
  done

  append_summary "✓ **Core Images**: Copied to \`site/raw/images/\`"
  # Prune stale core-* assets only when the source image set was enumerated:
  # a missing source images/ directory means "no images published by this run",
  # not "no images exist", so it must not wipe the published core-* assets.
  shopt -s nullglob
  for dest_img in "$dest_images"/core-*; do
    [ -f "$dest_img" ] || continue
    base="$(basename "$dest_img")"
    is_image_name "$base" || continue
    if ! grep -Fxq "$base" "$copied_list"; then
      rm -f "$dest_img"
      echo "  Removed stale image: $base"
    fi
  done
  shopt -u nullglob
fi

rm -f "$copied_list"
