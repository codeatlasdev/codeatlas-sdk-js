#!/usr/bin/env bash
# Builds standalone CLI binaries and release tarballs into bin-dist/.
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION="$(node -p "require('./package.json').version")"
grep -q "VERSION = \"$VERSION\"" src/cli.ts || { echo "src/cli.ts VERSION != package.json $VERSION"; exit 1; }
rm -rf bin-dist && mkdir -p bin-dist
for target in darwin-arm64 darwin-x64 linux-x64 linux-arm64; do
  stage="bin-dist/stage-$target"
  mkdir -p "$stage"
  bun build src/cli.ts --compile --target="bun-$target" --outfile "$stage/codeatlas"
  tar -czf "bin-dist/codeatlas-$VERSION-$target.tar.gz" -C "$stage" codeatlas
  rm -rf "$stage"
done
(cd bin-dist && shasum -a 256 *.tar.gz > SHA256SUMS)
cat bin-dist/SHA256SUMS
