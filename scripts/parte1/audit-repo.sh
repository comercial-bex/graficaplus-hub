#!/usr/bin/env bash
set -euo pipefail
printf 'Migrations:\n'
find supabase/migrations -maxdepth 1 -name '*.sql' -printf '%f\n' | sort
printf '\nSupabase any casts:\n'
rg -n "supabase as any|db as any|from\('[^']+' as any\)|rpc\('[^']+'\)" src supabase || true
printf '\nCritical frontend direct status updates:\n'
rg -n "update\(\{[^}]*status|\.from\(\"ordens_servico\"\).*update" src/routes src/lib || true
