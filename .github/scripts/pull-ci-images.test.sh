#!/usr/bin/env bash
# Regressao do fallback sem rede ou daemon Docker.
set -euo pipefail
script="$(cd "$(dirname "$0")" && pwd)/pull-ci-images.sh"
test_dir=$(mktemp -d)
trap 'rm -f "$test_dir/calls" "$test_dir/output"; rmdir "$test_dir"' EXIT
export calls="$test_dir/calls"

docker() {
  printf '%s\n' "$*" >> "$calls"
  case "$1" in
    compose)
      case "$scenario" in
        config-failure) return 42 ;;
        empty) return 0 ;;
        unexpected) echo 'untrusted.example/mongo:latest'; return 0 ;;
      esac
      printf '%s\n' public.ecr.aws/docker/library/mongo:8.3.11 public.ecr.aws/docker/library/redis:7-alpine
      ;;
    pull)
      case "$scenario:$2" in
        all-fail:*) return 1 ;;
        second:mirror.gcr.io/*|third:mirror.gcr.io/*|third:public.ecr.aws/*) return 1 ;;
      esac
      ;;
    tag)
      if [[ "$scenario" == tag-failure ]]; then return 43; fi
      ;;
    *) return 99 ;;
  esac
}
timeout() {
  [[ "$1" == 120s ]] || return 98
  shift
  if [[ "$scenario" == timed-out && "$3" == mirror.gcr.io/* ]]; then
    printf '%s\n' "timeout $*" >> "$calls"
    return 124
  fi
  "$@"
}
export -f docker timeout

for scenario in first second third timed-out all-fail config-failure empty unexpected tag-failure; do
  export scenario
  : > "$calls"
  status=0
  bash "$script" > "$test_dir/output" 2>&1 || status=$?
  case "$scenario" in
    first|second|third|timed-out)
      [[ "$status" == 0 ]]
      case "$scenario" in
        first) registry=mirror.gcr.io/library; pulls=2; tags=2 ;;
        second) registry=public.ecr.aws/docker/library; pulls=4; tags=0 ;;
        third) registry=docker.io/library; pulls=6; tags=2 ;;
        timed-out) registry=public.ecr.aws/docker/library; pulls=2; tags=0 ;;
      esac
      [[ "$(grep -c '^pull ' "$calls")" == "$pulls" ]]
      [[ "$(grep -c '^tag ' "$calls" || true)" == "$tags" ]]
      grep -Fxq "pull $registry/mongo:8.3.11" "$calls"
      grep -Fxq "pull $registry/redis:7-alpine" "$calls"
      if [[ "$tags" == 2 ]]; then
        grep -Fxq "tag $registry/mongo:8.3.11 public.ecr.aws/docker/library/mongo:8.3.11" "$calls"
        grep -Fxq "tag $registry/redis:7-alpine public.ecr.aws/docker/library/redis:7-alpine" "$calls"
      fi
      ;;
    all-fail)
      [[ "$status" == 1 ]]
      [[ "$(grep -c '^pull ' "$calls")" == 3 ]]
      ! grep -q '^tag ' "$calls"
      grep -q 'Nenhum registro forneceu' "$test_dir/output"
      ;;
    config-failure) [[ "$status" == 42 ]] ;;
    empty|unexpected)
      [[ "$status" == 1 ]]
      ! grep -q '^pull ' "$calls"
      ;;
    tag-failure)
      [[ "$status" == 43 ]]
      [[ "$(grep -c '^pull ' "$calls")" == 1 ]]
      ;;
  esac
  echo "PASS: $scenario"
done
