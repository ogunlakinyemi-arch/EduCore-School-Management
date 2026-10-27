import assert from "node:assert/strict";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import { Pool, type PoolClient } from "pg";
import { getTableConfig, PgDialect, type PgTable } from "drizzle-orm/pg-core";
import { hostedCheckoutOrders, hostedCheckoutEvents } from "@workspace/db/schema";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { HOSTED_HISTORY_GUARD_BODY } from "./hosted-manual-policy";
import { appendHostedEvent, hostedDatabaseReady } from "../services/hosted-payment-store";

const root=process.env.EDUCORE_JOURNAL_TEST_ROOT;
const suite=root?describe:describe.skip;
const order=`HCM1_T_${"a".repeat(32)}`;
const other=`HCM1_T_${"b".repeat(32)}`;
const quote=(s:string)=>`"${s.replaceAll('"','""')}"`;
const dialect=new PgDialect();

// Generate both journal tables, constraints, indexes and FKs from the actual
// pure Drizzle declarations. Parent tables are minimal fictional ID-only stubs.
function tableSQL(table:PgTable) {
  const config=getTableConfig(table);
  const expression=(value:Parameters<PgDialect["sqlToQuery"]>[0])=>
    dialect.sqlToQuery(value).sql.replaceAll(`${quote(config.name)}.`,"");
  const columns=config.columns.map(c=>{
    let result=`${quote(c.name)} ${c.getSQLType()}${c.notNull?" NOT NULL":""}${c.primary?" PRIMARY KEY":""}`;
    if(c.default!==undefined) {
      const value=c.default;
      const literal=typeof value==="string"?`'${value.replaceAll("'","''")}'`:
        value && typeof value==="object" && "queryChunks" in value?expression(value as Parameters<typeof expression>[0]):
        `'${JSON.stringify(value)}'::jsonb`;
      result+=` DEFAULT ${literal}`;
    }
    return result;
  });
  for(const c of config.checks) columns.push(`CONSTRAINT ${quote(c.name)} CHECK (${expression(c.value)})`);
  for(const fk of config.foreignKeys) {
    const ref=fk.reference(),parent=getTableConfig(ref.foreignTable);
    columns.push(`CONSTRAINT ${quote(fk.getName())} FOREIGN KEY (${ref.columns.map(c=>quote(c.name)).join(",")})
      REFERENCES ${quote(parent.name)} (${ref.foreignColumns.map(c=>quote(c.name)).join(",")}) ON DELETE ${fk.onDelete??"no action"}`);
  }
  const statements=[`CREATE TABLE ${quote(config.name)} (${columns.join(",")})`];
  for(const index of config.indexes) {
    const cfg=index.config;
    const cols=cfg.columns.map(c=>{
      assert.ok("name" in c && typeof c.name==="string","Review non-column journal index before extending fixture renderer.");
      return quote(c.name);
    });
    statements.push(`CREATE ${cfg.unique?"UNIQUE ":""}INDEX ${quote(cfg.name!)} ON ${quote(config.name)} (${cols.join(",")})${cfg.where?` WHERE ${expression(cfg.where)}`:""}`);
  }
  return statements;
}

suite("Hosted journal safeguards on a verified disposable PostgreSQL instance",()=>{
  let pool:Pool;
  beforeAll(async()=>{
    assert.equal(process.env.NODE_ENV,"test");
    assert.deepEqual(Object.keys(process.env).filter(k=>/^(?:PG|DATABASE|FLUTTERWAVE|REPLIT_)|SECRET|TOKEN|PASSWORD|API_KEY/.test(k)),[]);
    assert.match(root!,/^\/tmp\/educore-hosted-journal-[^/]+$/);
    const data=join(root!,"data"),socket=join(root!,"socket"),port=process.env.EDUCORE_JOURNAL_TEST_PORT!;
    const pid=readFileSync(join(data,"postmaster.pid"),"utf8").trim().split("\n");
    assert.equal(realpathSync(pid[1]),realpathSync(data));assert.equal(pid[3],port);assert.equal(pid[4],socket);
    const argv=readFileSync(`/proc/${pid[0]}/cmdline`,"utf8").split("\0");
    assert.equal(argv[argv.indexOf("-D")+1],data);assert.equal(argv[argv.indexOf("-h")+1],"");
    assert.equal(statSync(join(socket,`.s.PGSQL.${port}`)).isSocket(),true);
    vi.stubGlobal("fetch",()=>{throw new Error("All provider/network fetches forbidden in this journal rehearsal.");});
    pool=new Pool({host:socket,port:Number(port),user:"hosted_journal_qa",database:"postgres",
      max:2,connectionTimeoutMillis:2000,statement_timeout:3000,query_timeout:5000});
    // Second, independent in-server identity check before fixture DDL.
    const identity=(await pool.query(`SELECT current_setting('data_directory') AS data,
      current_setting('listen_addresses') AS listen,current_database() AS db,current_user AS role`)).rows[0];
    assert.equal(realpathSync(identity.data),realpathSync(data));
    assert.equal(identity.listen,"");assert.equal(identity.db,"postgres");assert.equal(identity.role,"hosted_journal_qa");
    const parents=new Set<string>();
    for(const table of [hostedCheckoutOrders,hostedCheckoutEvents]) for(const fk of getTableConfig(table).foreignKeys) {
      const name=getTableConfig(fk.reference().foreignTable).name;
      if(!["hosted_checkout_orders","hosted_checkout_events"].includes(name)) parents.add(name);
    }
    for(const name of parents) {
      await pool.query(`CREATE TABLE ${quote(name)} (id integer PRIMARY KEY)`);
      await pool.query(`INSERT INTO ${quote(name)} VALUES (1),(2)`);
    }
    for(const table of [hostedCheckoutOrders,hostedCheckoutEvents]) for(const sql of tableSQL(table)) await pool.query(sql);
    await pool.query(`CREATE FUNCTION public.hosted_history_guard() RETURNS trigger LANGUAGE plpgsql AS $guard$${HOSTED_HISTORY_GUARD_BODY}$guard$`);
    for(const table of ["hosted_checkout_orders","hosted_checkout_events"])
      await pool.query(`CREATE TRIGGER hosted_history_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON ${table}
        FOR EACH STATEMENT EXECUTE FUNCTION public.hosted_history_guard()`);
    for(const [reference,id] of [[order,1],[other,2]] as const)
      await pool.query(`INSERT INTO hosted_checkout_orders
        (reference,environment,subscription_id,school_id,student_id,term_id,payer_user_id,snapshot,idempotency_key)
        VALUES ($1,'TEST',$2,$2,$2,$2,$2,'{"studentName":"Fictional QA only","termName":"Fictional term"}',$1)`,[reference,id]);
  });
  afterAll(async()=>{if(pool)await pool.end();vi.unstubAllGlobals();});

  async function changed(sql:string,body:(client:PoolClient)=>Promise<void>) {
    const c=await pool.connect();
    try {await c.query("BEGIN");await c.query(sql);await body(c);}
    finally {await c.query("ROLLBACK");c.release();}
  }
  const sameConnection=(c:PoolClient)=>({connect:async()=>({query:c.query.bind(c),release(){}})});

  it("accepts only both canonical enabled statement-level UPDATE/DELETE/TRUNCATE bindings",async()=>{
    expect(await hostedDatabaseReady(pool)).toBe(true);
  });
  it.each(["hosted_checkout_orders","hosted_checkout_events"])("denies UPDATE, DELETE and TRUNCATE on %s, including empty predicates",async table=>{
    for(const sql of [`UPDATE ${table} SET environment='TEST' WHERE false`,`DELETE FROM ${table} WHERE false`,`TRUNCATE ${table} CASCADE`])
      await expect(pool.query(sql)).rejects.toMatchObject({code:"P0001",message:"Hosted payment history is append-only"});
  });
  it("allows append and idempotent replay, but prevents a second economic payment event",async()=>{
    const c=await pool.connect();
    try {
      const row={reference:order,environment:"TEST"};
      const fields={amount:500000,transactionId:"synthetic-no-provider-payment",fee:1000};
      expect(await appendHostedEvent(c,row,"PAYMENT_VERIFIED","synthetic-payment",fields)).toBe(true);
      expect(await appendHostedEvent(c,row,"PAYMENT_VERIFIED","synthetic-payment",fields)).toBe(false);
      await expect(appendHostedEvent(c,row,"PAYMENT_VERIFIED","different-key",fields)).rejects.toMatchObject({code:"23505"});
    } finally {c.release();}
  });
  it("enforces provider identity uniqueness, amount checks and order/mode foreign keys",async()=>{
    const c=await pool.connect();
    try {
      await expect(appendHostedEvent(c,{reference:other,environment:"TEST"},"PAYMENT_VERIFIED","duplicate-provider",
        {amount:500000,transactionId:"synthetic-no-provider-payment"})).rejects.toMatchObject({code:"23505"});
      await expect(appendHostedEvent(c,{reference:other,environment:"TEST"},"PAYMENT_VERIFIED","invalid-amount",
        {amount:1,transactionId:"synthetic-invalid"})).rejects.toMatchObject({code:"23514"});
      await expect(appendHostedEvent(c,{reference:other,environment:"LIVE"},"CHECKOUT_UNKNOWN","wrong-mode"))
        .rejects.toMatchObject({code:"23503"});
    } finally {c.release();}
  });
  it.each([
    "ALTER TABLE hosted_checkout_orders DISABLE TRIGGER hosted_history_immutable",
    "DROP TRIGGER hosted_history_immutable ON hosted_checkout_events",
    "DROP TABLE hosted_checkout_events",
    "ALTER FUNCTION public.hosted_history_guard() SECURITY DEFINER",
    "CREATE OR REPLACE FUNCTION public.hosted_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NULL; END$$",
    `DROP TRIGGER hosted_history_immutable ON hosted_checkout_orders;
     CREATE TRIGGER hosted_history_immutable BEFORE UPDATE OR DELETE ON hosted_checkout_orders
       FOR EACH ROW EXECUTE FUNCTION public.hosted_history_guard()`,
  ])("fails closed for altered/missing safeguards: %s",async sql=>{
    await changed(sql,async c=>expect(await hostedDatabaseReady(sameConnection(c))).toBe(false));
    expect(await hostedDatabaseReady(pool)).toBe(true);
  });
});
