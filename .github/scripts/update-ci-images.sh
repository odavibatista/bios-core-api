#!/usr/bin/env bash
# Atualiza (ou, com --check, apenas confere) os digests de ci-images.lock.
#
#   update-ci-images.sh           resolve o digest atual de cada tag e regrava o lock
#   update-ci-images.sh --check   falha se algum digest do lock nao e mais o da tag
#
# A tag publicada pode andar (rebuild da imagem base): o --check, agendado, avisa;
# a atualizacao e sempre deliberada, em PR proprio.
set -euo pipefail

lock="${CI_IMAGES_LOCK:-$(cd "$(dirname "$0")/.." && pwd)/ci-images.lock}"
mode="${1:-update}"
if [[ "$mode" != update && "$mode" != --check ]]; then
  echo "Uso: $0 [--check]" >&2
  exit 2
fi

resolve() {
  docker buildx imagetools inspect "docker.io/library/$1" | awk '/^Digest:/ { print $2; exit }'
}

output=$(mktemp)
trap 'rm -f "$output"' EXIT
drift=0

while IFS= read -r line; do
  if [[ -z "$line" || "$line" == \#* ]]; then
    printf '%s\n' "$line" >> "$output"
    continue
  fi
  read -r image current <<< "$line"
  latest=$(resolve "$image")
  if [[ ! "$latest" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    echo "::error::Nao foi possivel resolver o digest de $image." >&2
    exit 1
  fi
  if [[ "$latest" != "$current" ]]; then
    echo "::warning::$image mudou: $current -> $latest" >&2
    drift=1
  fi
  printf '%s %s\n' "$image" "$latest" >> "$output"
done < "$lock"

if [[ "$mode" == --check ]]; then
  if [[ "$drift" == 1 ]]; then exit 1; fi
  echo "Digests do lock conferem com as tags."
else
  cp "$output" "$lock"
  echo "ci-images.lock atualizado."
fi
