#!/usr/bin/env bash
# Regressao do fallback sem rede ou daemon Docker.
set -euo pipefail
script="$(cd "$(dirname "$0")" && pwd)/pull-ci-images.sh"
test_dir=$(mktemp -d)
trap 'rm -f "$test_dir/calls" "$test_dir/output" "$test_dir/lock" "$test_dir/lock-sem-redis"; rmdir "$test_dir"' EXIT
export calls="$test_dir/calls"
mongo_digest=sha256:$(printf 'a%.0s' {1..64})
redis_digest=sha256:$(printf 'b%.0s' {1..64})
printf '%s\n' '# comentario' "mongo:8.3.11 $mongo_digest" "redis:7-alpine $redis_digest" > "$test_dir/lock"
printf '%s\n' "mongo:8.3.11 $mongo_digest" > "$test_dir/lock-sem-redis"

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

for scenario in first second third timed-out all-fail config-failure empty unexpected tag-failure missing-digest; do
  export scenario
  export CI_IMAGES_LOCK="$test_dir/lock"
  if [[ "$scenario" == missing-digest ]]; then export CI_IMAGES_LOCK="$test_dir/lock-sem-redis"; fi
  : > "$calls"
  status=0
  bash "$script" > "$test_dir/output" 2>&1 || status=$?
  case "$scenario" in
    first|second|third|timed-out)
      [[ "$status" == 0 ]]
      case "$scenario" in
        first) registry=mirror.gcr.io/library; pulls=2 ;;
        second) registry=public.ecr.aws/docker/library; pulls=4 ;;
        third) registry=docker.io/library; pulls=6 ;;
        timed-out) registry=public.ecr.aws/docker/library; pulls=2 ;;
      esac
      [[ "$(grep -c '^pull ' "$calls")" == "$pulls" ]]
      # O conteudo e pedido pelo digest; a tag local e aplicada depois.
      grep -Fxq "pull $registry/mongo@$mongo_digest" "$calls"
      grep -Fxq "pull $registry/redis@$redis_digest" "$calls"
      [[ "$(grep -c '^tag ' "$calls")" == 2 ]]
      grep -Fxq "tag $registry/mongo@$mongo_digest public.ecr.aws/docker/library/mongo:8.3.11" "$calls"
      grep -Fxq "tag $registry/redis@$redis_digest public.ecr.aws/docker/library/redis:7-alpine" "$calls"
      # Nenhuma obtencao por tag solta.
      ! grep -Eq '^pull .*:[a-zA-Z0-9_.-]+$' "$calls"
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
    missing-digest)
      # O mongo e obtido; o redis, sem digest no lock, para a infraestrutura.
      [[ "$status" == 1 ]]
      [[ "$(grep -c '^pull ' "$calls")" == 1 ]]
      grep -q 'redis:7-alpine sem digest valido' "$test_dir/output"
      ;;
  esac
  echo "PASS: $scenario"
done
