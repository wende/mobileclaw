#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: gh-pr-watch.sh [--pr <number>] [--interval <seconds>]

Watches the current PR for CI/check state or comment-count changes.
State is persisted under the repository's git common dir and compared on relaunch.

Options:
  -p, --pr <number>        Watch a specific PR number (default: PR for current branch)
  -i, --interval <seconds> Poll interval in seconds (default: GH_PR_WATCH_INTERVAL or 15)
  -h, --help               Show this help
EOF
}

die() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

PR_NUMBER=""
POLL_INTERVAL="${GH_PR_WATCH_INTERVAL:-15}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    -p|--pr)
      [[ $# -ge 2 ]] || die "Missing value for $1"
      PR_NUMBER="$2"
      shift 2
      ;;
    -i|--interval)
      [[ $# -ge 2 ]] || die "Missing value for $1"
      POLL_INTERVAL="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "Unknown argument: $1"
      ;;
  esac
done

[[ "$POLL_INTERVAL" =~ ^[0-9]+$ ]] || die "Interval must be a positive integer"
[[ "$POLL_INTERVAL" -gt 0 ]] || die "Interval must be greater than 0"

if [[ -n "$PR_NUMBER" ]]; then
  [[ "$PR_NUMBER" =~ ^[0-9]+$ ]] || die "PR number must be numeric"
fi

require_cmd gh
require_cmd git
require_cmd jq

resolve_pr_number() {
  if [[ -n "$PR_NUMBER" ]]; then
    return 0
  fi

  local branch
  branch="$(git rev-parse --abbrev-ref HEAD)"
  [[ "$branch" != "HEAD" ]] || die "Detached HEAD; provide --pr <number>"

  PR_NUMBER="$(gh pr list --head "$branch" --state open --limit 1 --json number --jq '.[0].number // empty')"
  [[ -n "$PR_NUMBER" ]] || die "No open PR found for branch: $branch"
}

state_core() {
  jq -c '{comments, checks}' "$1"
}

states_differ() {
  [[ "$(state_core "$1")" != "$(state_core "$2")" ]]
}

fetch_state() {
  local output_file="$1"
  local pr_view_json
  local pr_api_json
  local checks_raw
  local checks_json
  local pr_url
  local pr_title
  local issue_comments
  local review_comments
  local total_comments

  pr_view_json="$(gh pr view "$PR_NUMBER" --json title,url)"
  pr_api_json="$(gh api "repos/$REPO/pulls/$PR_NUMBER")"
  checks_raw="$(gh pr checks "$PR_NUMBER" --json name,state,workflow 2>/dev/null || true)"

  pr_url="$(jq -r '.url' <<<"$pr_view_json")"
  pr_title="$(jq -r '.title' <<<"$pr_view_json")"
  issue_comments="$(jq -r '.comments // 0' <<<"$pr_api_json")"
  review_comments="$(jq -r '.review_comments // 0' <<<"$pr_api_json")"
  total_comments="$((issue_comments + review_comments))"

  if [[ -z "$checks_raw" ]] || ! jq -e . >/dev/null 2>&1 <<<"$checks_raw"; then
    checks_raw='[]'
  fi

  checks_json="$(jq -c '
    map({
      workflow: (.workflow // ""),
      name: (.name // ""),
      state: (.state // "")
    }) | sort_by(.workflow, .name)
  ' <<<"$checks_raw")"

  jq -n \
    --arg fetched_at "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
    --arg repo "$REPO" \
    --arg pr_number "$PR_NUMBER" \
    --arg pr_title "$pr_title" \
    --arg pr_url "$pr_url" \
    --argjson issue_comments "$issue_comments" \
    --argjson review_comments "$review_comments" \
    --argjson total_comments "$total_comments" \
    --argjson checks "$checks_json" \
    '{
      fetched_at: $fetched_at,
      repo: $repo,
      pr_number: $pr_number,
      pr_title: $pr_title,
      pr_url: $pr_url,
      comments: {
        issue: $issue_comments,
        review: $review_comments,
        total: $total_comments
      },
      checks: $checks
    }' >"$output_file"
}

print_state_summary() {
  local state_file="$1"
  local total
  local issue
  local review
  local check_count

  total="$(jq -r '.comments.total' "$state_file")"
  issue="$(jq -r '.comments.issue' "$state_file")"
  review="$(jq -r '.comments.review' "$state_file")"
  check_count="$(jq -r '.checks | length' "$state_file")"

  printf 'Comments: total=%s (issue=%s, review=%s)\n' "$total" "$issue" "$review"

  if [[ "$check_count" -eq 0 ]]; then
    echo "Checks: none reported"
    return 0
  fi

  jq -r '
    .checks
    | group_by(.state)
    | map("\(.[0].state): \(length)")
    | "Checks: " + (join(", "))
  ' "$state_file"
}

print_changes() {
  local old_state="$1"
  local new_state="$2"
  local diff_lines

  diff_lines="$(jq -rs '
    .[0] as $old
    | .[1] as $new
    | (if $old.comments.total != $new.comments.total then
      ["comment_total", ($old.comments.total | tostring), ($new.comments.total | tostring)]
    else empty end),
    (if $old.comments.issue != $new.comments.issue then
      ["comment_issue", ($old.comments.issue | tostring), ($new.comments.issue | tostring)]
    else empty end),
    (if $old.comments.review != $new.comments.review then
      ["comment_review", ($old.comments.review | tostring), ($new.comments.review | tostring)]
    else empty end),
    (
      ($old.checks // []) as $old_checks
      | ($new.checks // []) as $new_checks
      | (reduce $old_checks[] as $c ({}; .[($c.workflow // "") + "|" + ($c.name // "")] = ($c.state // "missing"))) as $old_map
      | (reduce $new_checks[] as $c ({}; .[($c.workflow // "") + "|" + ($c.name // "")] = ($c.state // "missing"))) as $new_map
      | ((($old_map | keys_unsorted) + ($new_map | keys_unsorted)) | unique | sort[]) as $key
      | select(($old_map[$key] // "missing") != ($new_map[$key] // "missing"))
      | ["check", $key, ($old_map[$key] // "missing"), ($new_map[$key] // "missing")]
    )
    | @tsv
  ' "$old_state" "$new_state")"

  if [[ -z "$diff_lines" ]]; then
    echo "- Tracked PR state changed"
    return 0
  fi

  while IFS=$'\t' read -r change_type col2 col3 col4; do
    case "$change_type" in
      comment_total)
        printf -- '- Total comments: %s -> %s\n' "$col2" "$col3"
        ;;
      comment_issue)
        printf -- '- Issue comments: %s -> %s\n' "$col2" "$col3"
        ;;
      comment_review)
        printf -- '- Review comments: %s -> %s\n' "$col2" "$col3"
        ;;
      check)
        local workflow
        local check_name
        workflow="${col2%%|*}"
        check_name="${col2#*|}"
        if [[ -n "$workflow" ]]; then
          printf -- '- Check [%s / %s]: %s -> %s\n' "$workflow" "$check_name" "$col3" "$col4"
        else
          printf -- '- Check [%s]: %s -> %s\n' "$check_name" "$col3" "$col4"
        fi
        ;;
    esac
  done <<< "$diff_lines"
}

resolve_pr_number
REPO="$(gh repo view --json nameWithOwner --jq '.nameWithOwner')"
GIT_COMMON_DIR="$(git rev-parse --git-common-dir)"
STATE_DIR="$GIT_COMMON_DIR/gh-pr-watch"
mkdir -p "$STATE_DIR"
REPO_SLUG="$(printf '%s' "$REPO" | tr '/:' '__')"
STATE_FILE="$STATE_DIR/${REPO_SLUG}-pr${PR_NUMBER}.json"

BASE_STATE="$(mktemp)"
CURRENT_STATE="$(mktemp)"
trap 'rm -f "$BASE_STATE" "$CURRENT_STATE"' EXIT

fetch_state "$CURRENT_STATE"

if [[ -f "$STATE_FILE" ]] && states_differ "$STATE_FILE" "$CURRENT_STATE"; then
  printf 'Changes detected since last saved state for PR #%s (%s)\n' "$PR_NUMBER" "$REPO"
  print_changes "$STATE_FILE" "$CURRENT_STATE"
  cp "$CURRENT_STATE" "$STATE_FILE"
  printf 'Saved updated state to %s\n' "$STATE_FILE"
  exit 0
fi

cp "$CURRENT_STATE" "$STATE_FILE"
cp "$CURRENT_STATE" "$BASE_STATE"

echo "Watching PR #$PR_NUMBER in $REPO"
echo "PR URL: $(jq -r '.pr_url' "$BASE_STATE")"
echo "State file: $STATE_FILE"
echo "Poll interval: ${POLL_INTERVAL}s"
print_state_summary "$BASE_STATE"

while true; do
  sleep "$POLL_INTERVAL"
  fetch_state "$CURRENT_STATE"
  if states_differ "$BASE_STATE" "$CURRENT_STATE"; then
    printf 'Update detected at %s\n' "$(date +"%Y-%m-%d %H:%M:%S %Z")"
    print_changes "$BASE_STATE" "$CURRENT_STATE"
    cp "$CURRENT_STATE" "$STATE_FILE"
    printf 'Saved updated state to %s\n' "$STATE_FILE"
    exit 0
  fi
done
