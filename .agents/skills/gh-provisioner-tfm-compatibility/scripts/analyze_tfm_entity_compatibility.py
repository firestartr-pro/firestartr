#!/usr/bin/env python3
"""Analyze gh_provisioner entity/Terraform module config compatibility.

This helper is intentionally conservative. It extracts likely config paths from
Terraform HCL and TypeScript patchData calls, then emits machine-readable JSON
for an agent to review manually.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlsplit


@dataclass(frozen=True)
class TfmSource:
    raw: str
    repo_url: str | None
    subdir: str | None
    ref: str | None
    local_path: str | None


@dataclass(frozen=True)
class PatchCall:
    file: str
    line: int
    path: str
    value_keys: list[str]
    dynamic: bool


APPROVED_TFM_REPO_URL = 'https://github.com/prefapp/tfm.git'
FULL_COMMIT_SHA_PATTERN = re.compile(r'^[0-9a-fA-F]{40}$')
GIT_TIMEOUT_SECONDS = 120
MAX_TF_FILES = 500
MAX_TF_FILE_BYTES = 1024 * 1024


def run_git(command: list[str], cwd: Path | None = None) -> None:
    env = os.environ.copy()
    env.update(
        {
            'GIT_TERMINAL_PROMPT': '0',
            'GIT_CONFIG_NOSYSTEM': '1',
            'GIT_PROTOCOL_FROM_USER': '0',
        }
    )
    subprocess.run(
        [
            'git',
            '-c',
            'protocol.allow=never',
            '-c',
            'protocol.https.allow=always',
            *command,
        ],
        cwd=cwd,
        check=True,
        env=env,
        text=True,
        timeout=GIT_TIMEOUT_SECONDS,
    )


def line_number(content: str, index: int) -> int:
    return content.count('\n', 0, index) + 1


def strip_git_prefix(value: str) -> str:
    return value[5:] if value.startswith('git::') else value


def split_ref(raw: str, explicit_ref: str | None) -> tuple[str, str | None]:
    if '?' not in raw:
        return raw, explicit_ref

    base, query = raw.split('?', 1)
    parsed = parse_qs(query)
    return base, explicit_ref or (parsed.get('ref', [None])[0])


def normalized_repo_url(repo_url: str) -> str:
    return repo_url if repo_url.endswith('.git') else f'{repo_url}.git'


def ensure_safe_remote_source(source: TfmSource) -> None:
    if source.local_path:
        return
    if normalized_repo_url(source.repo_url or '') != APPROVED_TFM_REPO_URL:
        raise ValueError(
            f'Remote Terraform modules must come from {APPROVED_TFM_REPO_URL}; '
            'clone other repositories manually and pass a local path instead'
        )
    if not source.ref:
        raise ValueError('Remote Terraform modules require an immutable commit SHA via --ref or ?ref=')
    if not FULL_COMMIT_SHA_PATTERN.match(source.ref):
        raise ValueError('Remote Terraform module ref must be a full 40-character commit SHA via --ref or ?ref=')


def safe_subdir_path(subdir: str) -> Path:
    normalized = subdir.replace('\\', '/')
    if normalized.startswith('/'):
        raise ValueError(f'Terraform module subdir must be relative: {subdir}')
    parts = [part for part in normalized.split('/') if part and part != '.']
    if any(part == '..' for part in parts):
        raise ValueError(f'Terraform module subdir must not escape the repository: {subdir}')
    return Path(*parts) if parts else Path('.')


def resolve_module_dir(root: Path, subdir: str | None) -> Path:
    module_dir = root / safe_subdir_path(subdir) if subdir else root
    if module_dir.is_symlink():
        raise ValueError(f'Terraform module directory must not be a symlink: {module_dir}')
    resolved_root = root.resolve()
    resolved_module_dir = module_dir.resolve()
    if resolved_module_dir != resolved_root and resolved_root not in resolved_module_dir.parents:
        raise ValueError(f'Terraform module subdir escapes the repository: {module_dir}')
    if not module_dir.exists():
        raise FileNotFoundError(f'Terraform module subdir not found: {module_dir}')
    return module_dir


def iter_tf_files(module_dir: Path) -> list[Path]:
    if module_dir.is_symlink():
        raise ValueError(f'Terraform module directory must not be a symlink: {module_dir}')

    tf_files: list[Path] = []
    # os.walk with followlinks=False (default) does not descend into
    # symlinked directories, preventing traversal outside module_dir.
    # Path.rglob(...) would follow symlinked directories by default.
    for root, dirs, files in os.walk(module_dir):
        dirs.sort()  # deterministic traversal order
        for f in sorted(files):
            if not f.endswith('.tf'):
                continue
            full_path = Path(root) / f
            if full_path.is_symlink() or not full_path.is_file():
                continue
            size = full_path.stat().st_size
            if size > MAX_TF_FILE_BYTES:
                raise ValueError(f'Terraform file exceeds {MAX_TF_FILE_BYTES} bytes: {full_path}')
            tf_files.append(full_path)
            if len(tf_files) > MAX_TF_FILES:
                raise ValueError(f'Terraform module exceeds {MAX_TF_FILES} .tf files: {module_dir}')
    return tf_files


def parse_tfm_source(raw_address: str, explicit_ref: str | None) -> TfmSource:
    raw_without_ref, ref = split_ref(strip_git_prefix(raw_address), explicit_ref)
    local_path = Path(raw_without_ref).expanduser()
    if local_path.exists():
        return TfmSource(
            raw=raw_address,
            repo_url=None,
            subdir=None,
            ref=ref,
            local_path=str(local_path.resolve()),
        )

    if '://' not in raw_without_ref and not raw_without_ref.startswith('git@'):
        if '//' in raw_without_ref:
            repo_slug, subdir = raw_without_ref.split('//', 1)
            repo_url = normalized_repo_url(f'https://github.com/{repo_slug}')
        else:
            repo_url = 'https://github.com/prefapp/tfm.git'
            subdir = f'modules/{raw_without_ref}'
        return TfmSource(raw=raw_address, repo_url=repo_url, subdir=subdir, ref=ref, local_path=None)

    repo_url = raw_without_ref
    subdir = None

    if '.git//' in raw_without_ref:
        before, after = raw_without_ref.split('.git//', 1)
        repo_url = f'{before}.git'
        subdir = after
    else:
        parsed = urlsplit(raw_without_ref)
        marker = parsed.path.find('//')
        if marker >= 0:
            repo_path = parsed.path[:marker]
            subdir = parsed.path[marker + 2 :]
            repo_url = f'{parsed.scheme}://{parsed.netloc}{repo_path}'

    return TfmSource(raw=raw_address, repo_url=repo_url, subdir=subdir, ref=ref, local_path=None)


def checkout_tfm(source: TfmSource, workdir: Path) -> Path:
    ensure_safe_remote_source(source)

    if source.local_path:
        return resolve_module_dir(Path(source.local_path), source.subdir)

    if not source.repo_url:
        raise ValueError(f'Cannot resolve Terraform module source: {source.raw}')

    repo_url = normalized_repo_url(source.repo_url)
    digest = hashlib.sha256(f'{repo_url}@{source.ref}'.encode()).hexdigest()[:16]
    clone_dir = workdir / digest
    if not clone_dir.exists():
        run_git(['clone', '--quiet', repo_url, str(clone_dir)])
    run_git(['checkout', '--quiet', '--detach', source.ref or ''], cwd=clone_dir)

    return resolve_module_dir(clone_dir, source.subdir)


def find_matching(text: str, start: int, open_char: str = '{', close_char: str = '}') -> int:
    depth = 0
    index = start
    in_string: str | None = None
    escaped = False
    in_line_comment = False
    in_block_comment = False

    while index < len(text):
        char = text[index]
        nxt = text[index + 1] if index + 1 < len(text) else ''

        if in_line_comment:
            if char == '\n':
                in_line_comment = False
            index += 1
            continue
        if in_block_comment:
            if char == '*' and nxt == '/':
                in_block_comment = False
                index += 2
            else:
                index += 1
            continue
        if in_string:
            if escaped:
                escaped = False
            elif char == '\\':
                escaped = True
            elif char == in_string:
                in_string = None
            index += 1
            continue

        if char in ('"', "'", '`'):
            in_string = char
        elif char == '/' and nxt == '/':
            in_line_comment = True
            index += 1
        elif char == '#' and open_char == '{':
            in_line_comment = True
        elif char == '/' and nxt == '*':
            in_block_comment = True
            index += 1
        elif char == open_char:
            depth += 1
        elif char == close_char:
            depth -= 1
            if depth == 0:
                return index
        index += 1

    return -1


def extract_block_after(pattern: re.Pattern[str], content: str) -> str | None:
    match = pattern.search(content)
    if not match:
        return None
    open_index = content.find('{', match.end() - 1)
    if open_index < 0:
        return None
    close_index = find_matching(content, open_index)
    if close_index < 0:
        return None
    return content[open_index : close_index + 1]


def extract_variable_config_block(module_dir: Path) -> tuple[str | None, str | None]:
    pattern = re.compile(r'variable\s+"config"\s*{', re.MULTILINE)
    for tf_file in iter_tf_files(module_dir):
        content = tf_file.read_text(encoding='utf-8')
        block = extract_block_after(pattern, content)
        if block:
            return str(tf_file), block
    return None, None


def extract_object_inner(block: str) -> str | None:
    marker = re.search(r'type\s*=\s*object\s*\(', block)
    if not marker:
        return None
    open_index = block.find('{', marker.end())
    if open_index < 0:
        return None
    close_index = find_matching(block, open_index)
    if close_index < 0:
        return None
    return block[open_index + 1 : close_index]


def top_level_assignments(object_inner: str) -> list[dict[str, Any]]:
    attributes: list[dict[str, Any]] = []
    depth = 0
    # strip_hcl_comments preserves string contents so // inside quoted
    # URLs such as "https://example.com" is not misidentified as a comment
    cleaned = strip_hcl_comments(object_inner)
    for raw_line in cleaned.splitlines():
        line = raw_line.strip()
        if depth == 0 and line:
            match = re.match(
                r'^(?:["\']([^"\']+)["\']|([A-Za-z_][A-Za-z0-9_-]*))\s*[:=]\s*(.+?)(?:,)?$',
                line,
            )
            if match:
                expr = match.group(3).strip()
                attributes.append(
                    {
                        'name': match.group(1) or match.group(2),
                        'required': not expr.startswith('optional('),
                        'typeExpression': expr,
                    }
                )
        depth += sum(line.count(ch) for ch in '({[')
        depth -= sum(line.count(ch) for ch in ')}]')
        if depth < 0:
            depth = 0
    return attributes


def normalize_config_path(path: str) -> str:
    path = path.strip()
    if path.startswith('/config'):
        return path
    if path.startswith('config.'):
        return '/' + path.replace('.', '/')
    if path.startswith('var.config'):
        return '/config' + path[len('var.config') :].replace('.', '/')
    return path


def strip_hcl_comments(content: str) -> str:
    output: list[str] = []
    index = 0
    in_string: str | None = None
    escaped = False
    in_line_comment = False
    in_block_comment = False

    while index < len(content):
        char = content[index]
        nxt = content[index + 1] if index + 1 < len(content) else ''

        if in_line_comment:
            if char == '\n':
                in_line_comment = False
                output.append(char)
            else:
                output.append(' ')
            index += 1
            continue

        if in_block_comment:
            if char == '*' and nxt == '/':
                in_block_comment = False
                output.extend('  ')
                index += 2
            else:
                output.append('\n' if char == '\n' else ' ')
                index += 1
            continue

        if in_string:
            output.append(char)
            if escaped:
                escaped = False
            elif char == '\\':
                escaped = True
            elif char == in_string:
                in_string = None
            index += 1
            continue

        if char in ('"', "'"):
            in_string = char
            output.append(char)
        elif char == '#':
            in_line_comment = True
            output.append(' ')
        elif char == '/' and nxt == '/':
            in_line_comment = True
            output.extend('  ')
            index += 1
        elif char == '/' and nxt == '*':
            in_block_comment = True
            output.extend('  ')
            index += 1
        else:
            output.append(char)
        index += 1

    return ''.join(output)


def extract_tfm_paths(module_dir: Path) -> list[str]:
    paths: set[str] = set()
    chain_pattern = re.compile(r'var\.config((?:\.[A-Za-z_][A-Za-z0-9_-]*)+)')
    index_pattern = re.compile(r'var\.config\[["\']([^"\']+)["\']\]')
    lookup_pattern = re.compile(r'lookup\(\s*var\.config\s*,\s*["\']([^"\']+)["\']')

    for tf_file in iter_tf_files(module_dir):
        content = strip_hcl_comments(tf_file.read_text(encoding='utf-8'))
        for match in chain_pattern.finditer(content):
            paths.add(normalize_config_path(f'var.config{match.group(1)}'))
        for match in index_pattern.finditer(content):
            paths.add(f'/config/{match.group(1)}')
        for match in lookup_pattern.finditer(content):
            paths.add(f'/config/{match.group(1)}')
    return sorted(paths)


def extract_string_literal(value: str) -> tuple[str, bool]:
    value = value.strip()
    if value.startswith(('"', "'", '`')):
        quote = value[0]
        end = value.find(quote, 1)
        if end > 0:
            literal = value[1:end]
            return literal, quote == '`' or '${' in literal
    return value, True


def extract_value_keys(call_block: str) -> list[str]:
    value_match = re.search(r'\bvalue\s*:', call_block)
    if not value_match:
        return []
    open_index = call_block.find('{', value_match.end())
    if open_index < 0:
        return []
    close_index = find_matching(call_block, open_index)
    if close_index < 0:
        return []
    value_inner = call_block[open_index + 1 : close_index]
    return [item['name'] for item in top_level_assignments(value_inner)]


def is_after_line_comment(content: str, index: int) -> bool:
    line_start = content.rfind('\n', 0, index) + 1
    in_string: str | None = None
    escaped = False
    cursor = line_start

    while cursor < index:
        char = content[cursor]
        nxt = content[cursor + 1] if cursor + 1 < index else ''

        if in_string:
            if escaped:
                escaped = False
            elif char == '\\':
                escaped = True
            elif char == in_string:
                in_string = None
        elif char in ('"', "'", '`'):
            in_string = char
        elif char == '/' and nxt == '/':
            return True
        cursor += 1

    return False


def extract_patch_calls(entity_dir: Path, repo_root: Path) -> list[PatchCall]:
    calls: list[PatchCall] = []
    for ts_file in sorted(entity_dir.rglob('*.ts')):
        content = ts_file.read_text(encoding='utf-8')
        for match in re.finditer(r'\bpatchData\s*\(\s*{', content):
            if is_after_line_comment(content, match.start()):
                continue
            open_index = content.find('{', match.start())
            close_index = find_matching(content, open_index)
            if close_index < 0:
                continue
            block = content[open_index : close_index + 1]
            path_match = re.search(r'\bpath\s*:\s*([^,\n]+)', block)
            if not path_match:
                continue
            raw_path, dynamic = extract_string_literal(path_match.group(1))
            calls.append(
                PatchCall(
                    file=str(ts_file.relative_to(repo_root)),
                    line=line_number(content, match.start()),
                    path=raw_path,
                    value_keys=extract_value_keys(block),
                    dynamic=dynamic,
                )
            )
    return calls


def produced_entity_paths(calls: list[PatchCall]) -> list[str]:
    paths: set[str] = set()
    for call in calls:
        if not call.path.startswith('/config'):
            continue
        paths.add(call.path)
        if call.value_keys and not call.path.endswith('/-') and not call.dynamic:
            for key in call.value_keys:
                paths.add(f'{call.path}/{key}')
    return sorted(paths)


def top_key(path: str) -> str | None:
    if not path.startswith('/config/'):
        return None
    parts = [part for part in path.split('/') if part]
    if len(parts) < 2:
        return None
    return parts[1]


def analyze(repo_root: Path, entity: str, tfm: str, ref: str | None, workdir: Path) -> dict[str, Any]:
    entity_dir = repo_root / 'packages' / 'gh_provisioner' / 'src' / 'entities' / entity
    if not entity_dir.exists():
        raise FileNotFoundError(f'Entity directory not found: {entity_dir}')

    source = parse_tfm_source(tfm, ref)
    module_dir = checkout_tfm(source, workdir)

    config_file, config_block = extract_variable_config_block(module_dir)
    top_level_attrs = top_level_assignments(extract_object_inner(config_block) or '') if config_block else []
    tfm_paths = extract_tfm_paths(module_dir)
    for attr in top_level_attrs:
        tfm_paths.append(f'/config/{attr["name"]}')
    tfm_paths = sorted(set(tfm_paths))

    patch_calls = extract_patch_calls(entity_dir, repo_root)
    entity_paths = produced_entity_paths(patch_calls)

    tfm_keys = {top_key(path) for path in tfm_paths}
    tfm_keys.discard(None)
    entity_keys = {top_key(path) for path in entity_paths}
    entity_keys.discard(None)

    required_tfm_keys = {attr['name'] for attr in top_level_attrs if attr['required']}
    has_inferred_contract = bool(tfm_keys)
    incompatible_paths = (
        [path for path in entity_paths if top_key(path) and top_key(path) not in tfm_keys]
        if has_inferred_contract
        else []
    )
    ignored_required = sorted(required_tfm_keys - entity_keys)
    dynamic_paths = sorted(call.path for call in patch_calls if call.dynamic)

    if not config_block:
        status = 'incompatible'
    elif not has_inferred_contract:
        status = 'needs-review'
    elif incompatible_paths or ignored_required:
        status = 'incompatible'
    elif dynamic_paths:
        status = 'needs-review'
    else:
        status = 'compatible'

    return {
        'entity': {
            'name': entity,
            'directory': str(entity_dir.relative_to(repo_root)),
            'patchCalls': [asdict(call) for call in patch_calls],
            'producedPaths': entity_paths,
            'topLevelKeys': sorted(key for key in entity_keys if key),
        },
        'tfm': {
            'rawAddress': tfm,
            'resolved': asdict(source),
            'moduleDirectory': str(module_dir),
            'configVariableFile': config_file,
            'configVariableFound': config_block is not None,
            'topLevelAttributes': top_level_attrs,
            'observedPaths': sorted(tfm_paths),
            'topLevelKeys': sorted(key for key in tfm_keys if key),
        },
        'compatibility': {
            'status': status,
            'incompatibleVariables': incompatible_paths,
            'ignoredRequiredVariables': ignored_required,
            'dynamicEntityPathsNeedingManualReview': dynamic_paths,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo-root', default='.', help='repository root')
    parser.add_argument('--entity', required=True, help='gh_provisioner entity directory name, e.g. ghrepo')
    parser.add_argument('--tfm', required=True, help='Terraform module name/address/local path')
    parser.add_argument('--ref', help='Terraform module full commit SHA for remote sources')
    parser.add_argument(
        '--workdir',
        default=os.path.join(tempfile.gettempdir(), 'gh-provisioner-tfm-compatibility'),
        help='directory for checked-out Terraform modules',
    )
    args = parser.parse_args()

    repo_root = Path(args.repo_root).resolve()
    workdir = Path(args.workdir).resolve()
    workdir.mkdir(parents=True, exist_ok=True)

    try:
        result = analyze(repo_root, args.entity, args.tfm, args.ref, workdir)
    except (FileNotFoundError, ValueError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
        print(json.dumps({'error': str(error)}, indent=2), file=sys.stderr)
        return 1

    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
