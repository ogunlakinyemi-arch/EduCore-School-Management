#!/bin/bash
set -e
pnpm install --frozen-lockfile
# Schema reconciliation is deliberately not automatic. Installation must never
# infer that DATABASE_URL targets disposable Development data.
echo "Dependencies installed; schema writes skipped. Review and approval required."
