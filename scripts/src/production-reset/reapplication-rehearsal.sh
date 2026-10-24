#!/usr/bin/env bash
# Run from workspace root. No inherited application credentials, PG defaults,
# provider credentials, current database dumps, shared settings or existing ports.
set -euo pipefail
exec env -i PATH="$PATH" HOME="$HOME" LANG=C.UTF-8 NODE_ENV=test \
  PGPASSFILE=/dev/null PGSERVICEFILE=/dev/null bash --noprofile --norc <<'LOCAL_REAPPLICATION'
set -euo pipefail
umask 077
for tool in initdb pg_ctl psql; do "$tool" --version | grep -Eq '\(PostgreSQL\) 16\.'; done
WORK="$(mktemp -d /tmp/educore-partner-reapplication.XXXXXXXX)"
STARTED=0
cleanup() {
  case "$WORK" in /tmp/educore-partner-reapplication.*) ;; *) return 1 ;; esac
  if [ "$STARTED" = 1 ]; then
    pg_ctl -D "$WORK/data" -m fast -w -t 30 stop >/dev/null || return 1
  fi
  rm -rf -- "$WORK"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
mkdir -m 700 "$WORK/socket"
initdb -D "$WORK/data" --username=reapplication_admin --encoding=UTF8 --no-locale \
  --auth-local=trust --auth-host=reject >"$WORK/init.log" 2>&1
STARTED=1
pg_ctl -D "$WORK/data" -l "$WORK/server.log" -o "-k $WORK/socket -p 55484 -c listen_addresses='' -c unix_socket_permissions=0700" -w -t 30 start >/dev/null
PSQL=(psql -X -w -h "$WORK/socket" -p 55484 -U reapplication_admin -d postgres -v ON_ERROR_STOP=1)
"${PSQL[@]}" -v fixture_data="$WORK/data" -v fixture_socket="$WORK/socket" <<'VERIFY'
SELECT current_user='reapplication_admin' AND current_database()='postgres'
 AND inet_server_addr() IS NULL AND current_setting('listen_addresses')=''
 AND current_setting('data_directory')=:'fixture_data'
 AND current_setting('unix_socket_directories')=:'fixture_socket'
 AND NOT EXISTS(SELECT 1 FROM pg_class WHERE relnamespace='public'::regnamespace) AS fresh
\gset
\if :fresh
\else
 \quit 4
\endif
VERIFY
"${PSQL[@]}" -f scripts/src/production-reset/partner-reapplication-fixture.sql >/dev/null
for migration in 0169_account_applications 0170_account_application_partner_type; do
  "${PSQL[@]}" -f "lib/db/drizzle/$migration.sql" >/dev/null
done
"${PSQL[@]}" >/dev/null <<'BASELINE'
INSERT INTO app_users(clerk_user_id,email) VALUES('migration_baseline','baseline@fictional.invalid');
INSERT INTO account_applications(user_id,applicant_type,partner_type,first_name,last_name,email,phone,city,state)
 SELECT id,'PARTNER','INDIVIDUAL','Baseline','Fixture',email,'+2348012345678','','' FROM app_users;
BASELINE
snapshot() {
  "${PSQL[@]}" -Atq -c "SELECT md5(jsonb_build_object(
    'users',(SELECT jsonb_agg(to_jsonb(u) ORDER BY id) FROM app_users u),
    'applications',(SELECT jsonb_agg(to_jsonb(a)-'reapplication_id' ORDER BY id) FROM account_applications a))::text)"
}
BEFORE="$(snapshot)"
"${PSQL[@]}" --single-transaction -f lib/db/drizzle/0174_partner_account_reapplications.sql >/dev/null
test "$BEFORE" = "$(snapshot)"
if "${PSQL[@]}" --single-transaction -f lib/db/drizzle/0174_partner_account_reapplications.sql >"$WORK/duplicate.log" 2>&1; then
  echo "DUPLICATE_MIGRATION_MUST_REFUSE"; exit 4
fi
test "$BEFORE" = "$(snapshot)"
echo "POPULATED_MIGRATION_PRESERVATION_AND_DUPLICATE_REFUSAL_PASS"
REAPPLICATION_TEST_SOCKET="$WORK/socket" REAPPLICATION_TEST_DATA="$WORK/data" \
pnpm --filter @workspace/api-server exec vitest run src/routes/partner-reapplication.postgres.test.ts
LOCAL_REAPPLICATION
