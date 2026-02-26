#!/bin/sh
set -eu

git config core.hooksPath .githooks
if [ -f .githooks/pre-commit ]; then
  chmod +x .githooks/pre-commit
fi

echo "Git hooks installed: core.hooksPath=.githooks"
