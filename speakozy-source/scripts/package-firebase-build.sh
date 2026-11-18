#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

pnpm build
rm -f speakozy-firebase-build.zip
zip -qr speakozy-firebase-build.zip dist
printf 'Created %s/speakozy-firebase-build.zip\n' "$ROOT"
