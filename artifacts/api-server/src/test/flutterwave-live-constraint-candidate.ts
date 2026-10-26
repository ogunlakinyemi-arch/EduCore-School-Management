/** TEST ONLY. Counterexample fixture, never an installer or runtime dependency.
 * Build a separate constraint-only candidate from unchanged original SQL in the
 * existing identity-checked disposable six-migration cluster. Original objects
 * and their functions/triggers remain intact. No URL/environment credentials.
 */
import { expect } from "vitest";
import type { DatabasePoolClient } from "@workspace/db/driver";

export const candidateSchema = "relational_candidate";

export async function createConstraintCandidate(
  client: DatabasePoolClient, originals: string[], directory: string, database: string,
) {
  expect(directory).toMatch(/\/educore-six-live-pg-[^/]+$/);
  expect(database).toMatch(/^six_case_\d+$/);
  expect((await client.query(`SELECT current_database() AS name,
    current_setting('data_directory') AS dir,inet_server_addr() AS addr,current_user AS who`)).rows[0])
    .toEqual({ name: database, dir: `${directory}/data`, addr: null, who: "six_fixture" });
  expect(originals).toHaveLength(6);
  await client.query(`CREATE SCHEMA ${candidateSchema}; SET search_path=${candidateSchema},public`);
  const expectedFunctions = [0, 3, 2, 0, 1, 3];
  const expectedTriggers = [0, 5, 8, 1, 3, 3];
  for (const [index, original] of originals.entries()) {
    let functions = 0, triggers = 0;
    const candidate = original
      .replace(/^CREATE FUNCTION [\s\S]*?\$\$;/gm, () => { functions++; return ""; })
      .replace(/^CREATE TRIGGER [\s\S]*?EXECUTE FUNCTION [^;]+;/gm, () => { triggers++; return ""; });
    expect(functions).toBe(expectedFunctions[index]);
    expect(triggers).toBe(expectedTriggers[index]);
    // Only the separate candidate omits the procedural objects. Keep every
    // table, column, CHECK, FK, unique/partial index and generated calculation.
    await client.query(candidate);
  }
}

export async function relationalShape(client: DatabasePoolClient, schema: string) {
  const constraints = (await client.query(`SELECT t.relname,c.conname,c.contype,c.convalidated,
      pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
    WHERE c.connamespace=$1::regnamespace AND t.relname LIKE 'flutterwave_live_%'
    ORDER BY t.relname,c.conname`, [schema])).rows;
  const indexes = (await client.query(`SELECT tablename,indexname,indexdef FROM pg_indexes
    WHERE schemaname=$1 AND tablename LIKE 'flutterwave_live_%' ORDER BY tablename,indexname`, [schema])).rows;
  const columns = (await client.query(`SELECT c.relname,a.attname,format_type(a.atttypid,a.atttypmod) AS type,
      a.attnotnull,a.attgenerated,pg_get_expr(d.adbin,d.adrelid) AS default_expression
    FROM pg_class c JOIN pg_attribute a ON a.attrelid=c.oid
    LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
    WHERE c.relnamespace=$1::regnamespace AND c.relkind='r'
      AND c.relname LIKE 'flutterwave_live_%' AND a.attnum>0 AND NOT a.attisdropped
    ORDER BY c.relname,a.attnum`, [schema])).rows;
  return JSON.parse(JSON.stringify({ constraints, indexes, columns })
    .replaceAll("public.", "").replaceAll(`${candidateSchema}.`, ""));
}

export async function seedConstraintEvidence(client: DatabasePoolClient, schema: "public" | typeof candidateSchema) {
  await client.query(`SET search_path=${schema},public;
    INSERT INTO flutterwave_live_webhook_receipts(id,payload_sha256,payload_bytes,claims,signature_verified)
      VALUES(1,'${"a".repeat(64)}',80,'{}',true);
    INSERT INTO flutterwave_live_subscription_intents
      (id,merchant_scope,reference,school_id,student_id,session_id,term_id,term_end_date,
       school_subaccount_id,partner_profile_id,partner_accrual_minor,state,
       verified_transaction_id,verified_provider_reference)
      VALUES(1,'fixture_merchant','SCV3_live_constraint_fixture',10,1,1,1,current_date+30,
       'RS_fixtureowner12345678',7,10000,'COLLECTION_VERIFIED','123','fixture_provider_ref');
    INSERT INTO flutterwave_live_collection_evidence
      (intent_id,merchant_scope,school_subaccount_id,transaction_id,provider_reference,
       gross_minor,currency,school_minor,merchant_gross_minor,partner_accrual_minor,provider_fee_minor,additional_fee_minor)
      VALUES(1,'fixture_merchant','RS_fixtureowner12345678','123','fixture_provider_ref',
       500000,'NGN',190000,310000,10000,500,50);
    INSERT INTO flutterwave_live_finalization_events
      (id,intent_id,semantic_key,kind,transaction_id,source_payload_sha256)
      VALUES(1,1,'${"b".repeat(64)}','COLLECTION','123','${"a".repeat(64)}');
    INSERT INTO flutterwave_live_receipt_results(receipt_id,event_id) VALUES(1,1);
    INSERT INTO flutterwave_live_partner_accruals(intent_id,partner_profile_id,amount_minor,state)
      VALUES(1,7,10000,'ACCRUED');
    INSERT INTO flutterwave_live_subscription_activations(intent_id,status,expires_at)
      VALUES(1,'ACTIVE',now()+interval '30 days');
    INSERT INTO flutterwave_live_official_receipts(intent_id,receipt_number,snapshot)
      VALUES(1,'FICTIONAL-CONSTRAINT-RECEIPT','{}');
    INSERT INTO flutterwave_live_commission_batches
      (id,merchant_scope,idempotency_key,request_hash,approved_by,snapshot)
      VALUES(1,'fixture_merchant','fixture_constraint_key_123','${"c".repeat(64)}',7,'{}');
    INSERT INTO flutterwave_live_commission_items(batch_id,intent_id) VALUES(1,1);
    INSERT INTO flutterwave_live_workflow_audits(actor_id,action,batch_id)
      VALUES(7,'APPROVE_EXPORT_ONLY',1);
    INSERT INTO flutterwave_live_checkout_attempts(intent_id,state) VALUES(1,'UNKNOWN')`);
}
