#!/usr/bin/env bash
# Regressao da atualizacao do lock sem rede ou daemon Docker.
set -euo pipefail
script="$(cd "$(dirname "$0")" && pwd)/update-ci-images.sh"
test_dir=$(mktemp -d)
trap 'rm -f "$test_dir"/*; rmdir "$test_dir"' EXIT
old=sha256:$(printf 'a%.0s' {1..64})
new=sha256:$(printf 'c%.0s' {1..64})
export CI_IMAGES_LOCK="$test_dir/lock"

docker() {
  [[ "$1 $2 $3" == "buildx imagetools inspect" ]] || return 99
  case "$scenario" in
    unresolved) echo 'Name: x' ;;
    *) printf 'Name: %s\nMediaType: x\nDigest:    %s\n' "$4" "$resolved" ;;
  esac
}
export -f docker

fresh_lock() { printf '%s\n' '# comentario' "mongo:8.3.11 $old" > "$CI_IMAGES_LOCK"; }

scenario=check-same; resolved=$old; export scenario resolved
fresh_lock
bash "$script" --check > /dev/null 2>&1
echo "PASS: $scenario"

scenario=check-drift; resolved=$new; export scenario resolved
fresh_lock
status=0
bash "$script" --check > /dev/null 2>&1 || status=$?
[[ "$status" == 1 ]]
grep -Fq "mongo:8.3.11 $old" "$CI_IMAGES_LOCK" # --check nunca grava
echo "PASS: $scenario"

scenario=update; resolved=$new; export scenario resolved
fresh_lock
bash "$script" > /dev/null 2>&1
grep -Fxq "mongo:8.3.11 $new" "$CI_IMAGES_LOCK"
grep -Fxq '# comentario' "$CI_IMAGES_LOCK"
echo "PASS: $scenario"

scenario=unresolved; resolved=$new; export scenario resolved
fresh_lock
status=0
bash "$script" > /dev/null 2>&1 || status=$?
[[ "$status" == 1 ]]
grep -Fq "mongo:8.3.11 $old" "$CI_IMAGES_LOCK" # falha nao regrava
echo "PASS: $scenario"
