/** TEST ONLY. No app URL, secret, production installer or schema hook.
 * Demonstrates ordinary PostgreSQL permissions, NOT Replit role provisioning.
 * Caller supplies the existing identity-checked disposable six-migration fixture.
 */
import { expect } from "vitest";
import { DatabasePool, type DatabasePoolClient } from "@workspace/db/driver";
import { candidateSchema } from "./flutterwave-live-constraint-candidate";

export async function permissionBoundary(
  client: DatabasePoolClient, directory: string, database: string,
) {
  expect(directory).toMatch(/\/educore-six-live-pg-[^/]+$/);
  expect(database).toMatch(/^six_case_\d+$/);
  expect((await client.query(`SELECT current_database() AS name,
    current_setting('data_directory') AS dir,inet_server_addr() AS addr,current_user AS who`)).rows[0])
    .toEqual({ name: database, dir: `${directory}/data`, addr: null, who: "six_fixture" });
  const owner = `${database}_schema_owner`, runtime = `${database}_runtime`, migration = `${database}_migration`;
  // Fixed synthetic roles in a temporary Unix-socket cluster using trust auth.
  // No passwords, environment credentials, app settings or original objects.
  await client.query(`
    CREATE ROLE ${owner} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    CREATE ROLE ${runtime} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    CREATE ROLE ${migration} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    GRANT ${owner} TO ${migration};
    ALTER SCHEMA ${candidateSchema} OWNER TO ${owner};
    REVOKE ALL ON SCHEMA ${candidateSchema} FROM PUBLIC;
    GRANT USAGE ON SCHEMA ${candidateSchema} TO ${runtime}`);
  const objects = (await client.query(`SELECT c.relname,c.relkind FROM pg_class c
    WHERE c.relnamespace=$1::regnamespace AND c.relkind IN('r','S') ORDER BY c.relkind,c.relname`,
    [candidateSchema])).rows;
  for (const object of objects) {
    expect(object.relname).toMatch(/^flutterwave_live_[a-z_]+$/);
    if (object.relkind === "r") {
      // Owned serial sequences transfer with their tables.
      await client.query(`ALTER TABLE ${candidateSchema}.${object.relname} OWNER TO ${owner}`);
    }
  }
  await client.query(`
    REVOKE ALL ON ALL TABLES IN SCHEMA ${candidateSchema} FROM PUBLIC;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA ${candidateSchema} FROM PUBLIC;
    GRANT SELECT ON ALL TABLES IN SCHEMA ${candidateSchema} TO ${runtime};
    GRANT USAGE ON ALL SEQUENCES IN SCHEMA ${candidateSchema} TO ${runtime};
    GRANT INSERT ON
      ${candidateSchema}.flutterwave_live_collection_evidence,
      ${candidateSchema}.flutterwave_live_finalization_events,
      ${candidateSchema}.flutterwave_live_receipt_results,
      ${candidateSchema}.flutterwave_live_official_receipts,
      ${candidateSchema}.flutterwave_live_authority_reviews,
      ${candidateSchema}.flutterwave_live_reconciliation_cases,
      ${candidateSchema}.flutterwave_live_commission_items,
      ${candidateSchema}.flutterwave_live_workflow_audits,
      ${candidateSchema}.flutterwave_live_operator_reviews,
      ${candidateSchema}.flutterwave_live_school_configuration,
      ${candidateSchema}.flutterwave_live_allocation_reviews,
      ${candidateSchema}.flutterwave_live_school_onboarding_audits TO ${runtime};
    GRANT UPDATE(state,on_hold,verified_transaction_id,verified_provider_reference)
      ON ${candidateSchema}.flutterwave_live_subscription_intents TO ${runtime};
    GRANT UPDATE(state) ON ${candidateSchema}.flutterwave_live_partner_accruals TO ${runtime};
    GRANT UPDATE(status) ON ${candidateSchema}.flutterwave_live_subscription_activations,
      ${candidateSchema}.flutterwave_live_commission_batches TO ${runtime};
    GRANT UPDATE(state,checkout_url) ON ${candidateSchema}.flutterwave_live_checkout_attempts TO ${runtime};
    ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA ${candidateSchema}
      REVOKE ALL ON TABLES FROM PUBLIC;
    ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA ${candidateSchema}
      GRANT SELECT ON TABLES TO ${runtime}`);
  const options = { host: directory, port: 55436, database, password: "", ssl: false as const,
    connectionTimeoutMillis: 2000, max: 1 };
  return {
    owner, runtimeRole: runtime,
    runtime: new DatabasePool({ ...options, user: runtime }),
    migration: new DatabasePool({ ...options, user: migration }),
  };
}
