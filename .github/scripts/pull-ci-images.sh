#!/usr/bin/env bash
# Mesmas imagens oficiais do Compose, fixadas por digest (.github/ci-images.lock),
# obtidas de registros alternativos. O digest, e nao a tag, decide o conteudo.
set -euo pipefail

lock="${CI_IMAGES_LOCK:-$(cd "$(dirname "$0")/.." && pwd)/ci-images.lock}"

images=$(docker compose -f docker-compose.yml -f docker-compose.ci.yml config --images mongodb redis)
if [[ -z "$images" ]]; then
  echo "::error::Compose nao retornou as imagens de teste." >&2
  exit 1
fi

while IFS= read -r target; do
  if [[ ! "$target" =~ ^public\.ecr\.aws/docker/library/(mongo|redis):[a-zA-Z0-9_.-]+$ ]]; then
    echo "::error::Imagem de teste inesperada: $target" >&2
    exit 1
  fi

  image="${target#public.ecr.aws/docker/library/}"
  digest=$(awk -v image="$image" '$1 == image { print $2 }' "$lock")
  if [[ ! "$digest" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    echo "::error::$image sem digest valido em ci-images.lock. Rode .github/scripts/update-ci-images.sh." >&2
    exit 1
  fi

  name="${image%%:*}"
  downloaded=false
  for registry in mirror.gcr.io/library public.ecr.aws/docker/library docker.io/library; do
    candidate="$registry/$name@$digest"
    echo "Obtendo $candidate"
    # Limita cada tentativa para liberar o proximo registro se houver travamento.
    if timeout 120s docker pull "$candidate"; then
      # Compose e o --pull never procuram a tag local; o conteudo veio do digest.
      docker tag "$candidate" "$target"
      downloaded=true
      break
    fi
    echo "::warning::Falha ao obter $candidate; tentando o proximo registro." >&2
  done

  if [[ "$downloaded" != true ]]; then
    echo "::error::Nenhum registro forneceu $image. Infraestrutura nao sera iniciada." >&2
    exit 1
  fi
done <<< "$images"
