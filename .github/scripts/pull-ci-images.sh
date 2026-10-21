#!/usr/bin/env bash
# Mesmas imagens oficiais e tags do Compose, com registros alternativos.
set -euo pipefail

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
  downloaded=false
  for registry in mirror.gcr.io/library public.ecr.aws/docker/library docker.io/library; do
    candidate="$registry/$image"
    echo "Obtendo $candidate"
    # Limita cada tentativa para liberar o proximo registro se houver travamento.
    if timeout 120s docker pull "$candidate"; then
      if [[ "$candidate" != "$target" ]]; then
        docker tag "$candidate" "$target"
      fi
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
