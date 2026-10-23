import assert from "node:assert/strict";
import { analyticalTree, extractCheck, parsePgTree } from "./pg-check-tree.mjs";

const and=(a,b)=>a===false||b===false?false:a===null||b===null?null:true;
const length=value=>value===null?null:[...value.replace(/^ +| +$/g,"")].length;
const between=(n,min,max)=>n===null?null:n>=min&&n<=max;
export function historyCases() {
  const events=[null,"","aa","abc","x".repeat(80),"x".repeat(81)," abc ","éé","😀😀😀"];
  const reasons=[null,"","aa","abc","x".repeat(1000),"x".repeat(1001)," abc ","ééé"];
  return events.flatMap((event_type,i)=>reasons.map((reason,j)=>({name:`history-${i}-${j}`,
    input:{event_type,reason},expected:and(between(length(event_type),3,80),between(length(reason),3,1000))})));
}
export function weekdayCases() {
  return [
    ["null",null,null],["empty",[],false],["one",["MONDAY"],true],
    ["all",["MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SATURDAY","SUNDAY"],true],
    ["lowercase",["monday"],false],["unknown",["HOLIDAY"],false],["empty-string",[""],false],
    ["padded",[" MONDAY "],false],["duplicates",["MONDAY","MONDAY"],true],
    ["seven-duplicates",Array(7).fill("MONDAY"),true],["eight-duplicates",Array(8).fill("MONDAY"),false],
    ["only-null",[null],false],["mixed-null",["MONDAY",null],false],
    ["mixed-invalid",["MONDAY","NO"],false],["multidimensional",[["MONDAY","TUESDAY"],["FRIDAY","SUNDAY"]],true],
  ].map(([name,weekdays,expected])=>({name,input:{weekdays},expected}));
}
const quote=value=>"'"+value.replaceAll("'","''")+"'";

export function verifyCheckSemantics(r,rawStatements,assessment) {
  const specs=[
    {table:"transport_history",name:"transport_history_event_reason_check",columns:"event_type text, reason text",
      fields:["event_type","reason"],cases:historyCases()},
    {table:"transport_routes",name:"transport_routes_weekdays_check",columns:"weekdays text[]",
      fields:["weekdays"],cases:weekdayCases()},
  ];
  const evidence=[];
  for(const spec of specs) {
    const source=rawStatements.find(sql=>sql.startsWith(`CREATE TABLE "${spec.table}"`));
    assert.ok(source);
    const original=extractCheck(source,spec.name);
    const retained=assessment.catalogDifferences.find(d=>d.before?.name===spec.name);
    assert.ok(retained&&retained.after);
    const variants={original,restored:retained.after.definition},observed={};
    for(const [variant,definition] of Object.entries(variants)) {
      const db="rehearsal_check_"+variant;
      r.sql(db,`CREATE TABLE ${spec.table}(${spec.columns},CONSTRAINT ${spec.name} ${definition});`,"create-"+variant+"-"+spec.name);
      const parsed=r.json(db,`SELECT jsonb_build_object('nodeTree',conbin::text,'definition',pg_get_constraintdef(oid))
        FROM pg_constraint WHERE conname=${quote(spec.name)};`,"parsed-"+variant+"-"+spec.name);
      const tree=parsePgTree(parsed.nodeTree);
      const expression=parsed.definition.replace(/^CHECK\s*/,"");
      const casesJson=JSON.stringify(spec.cases);assert.ok(!casesJson.includes("$cases$"));
      const rows=r.json(db,`CREATE TEMP TABLE checks_result(name text,truth boolean,sqlstate text);
        DO $test$ DECLARE item jsonb; verdict boolean; status text; BEGIN
          FOR item IN SELECT value FROM jsonb_array_elements($cases$${casesJson}$cases$::jsonb) LOOP
            EXECUTE ${quote(`SELECT ${expression} FROM jsonb_populate_record(NULL::${spec.table},$1) AS ${spec.table}`)}
              INTO verdict USING item->'input';
            status:='00000';
            BEGIN
              EXECUTE ${quote(`INSERT INTO ${spec.table} SELECT * FROM jsonb_populate_record(NULL::${spec.table},$1)`)} USING item->'input';
            EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS status=RETURNED_SQLSTATE;
            END;
            DELETE FROM ${spec.table};
            INSERT INTO checks_result VALUES(item->>'name',verdict,status);
          END LOOP;
        END $test$;
        SELECT jsonb_agg(to_jsonb(t) ORDER BY name) FROM checks_result t;`,"input-matrix-"+variant+"-"+spec.name);
      for(const row of rows) {
        const expected=spec.cases.find(c=>c.name===row.name).expected;
        assert.equal(row.truth,expected,row.name+" truth");
        assert.equal(row.sqlstate,expected===false?"23514":"00000",row.name+" CHECK enforcement");
      }
      r.check(true,`${variant} ${spec.name}: ${rows.length} independent expected truth/enforcement cases`);
      // Keep NULL CHECK behavior separate from the original schema's NOT NULL.
      r.sql(db,`ALTER TABLE ${spec.table} ${spec.fields.map(f=>`ALTER COLUMN ${f} SET NOT NULL`).join(",")};`,"strict-columns-"+variant);
      const nullInput=JSON.stringify(Object.fromEntries(spec.fields.map(f=>[f,null])));
      r.sql(db,`INSERT INTO ${spec.table} SELECT * FROM jsonb_populate_record(NULL::${spec.table},${quote(nullInput)}::jsonb);`,
        "nullability-"+variant+"-"+spec.name,"23502");
      observed[variant]={inputDefinition:definition,...parsed,tree,analytical:analyticalTree(tree),rows};
    }
    r.equal(observed.original.rows,observed.restored.rows,"same TRUE/FALSE/UNKNOWN and insertion behavior: "+spec.name);
    r.equal(observed.original.analytical,observed.restored.analytical,"same typed PostgreSQL expression leaves and associative AND: "+spec.name);
    const functions=new Set();
    function collect(value) {
      if(!value||typeof value!=="object")return;
      if(value.fields)for(const key of [":funcid",":opfuncid"])if(value.fields[key])functions.add(Number(value.fields[key][0]));
      for(const child of Object.values(value))if(Array.isArray(child))child.forEach(collect);else collect(child);
    }
    collect(observed.original.tree);
    assert.ok(functions.size>0&&[...functions].every(Number.isSafeInteger));
    const functionCatalog=r.json("rehearsal_check_original",`SELECT jsonb_agg(jsonb_build_object('oid',p.oid,'name',p.proname,
      'schema',n.nspname,'arguments',pg_get_function_identity_arguments(p.oid),'volatility',p.provolatile,'strict',p.proisstrict) ORDER BY p.oid)
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.oid IN (${[...functions].join(",")});`,"check-builtin-semantics");
    r.check(functionCatalog.length===functions.size&&functionCatalog.every(f=>f.schema==="pg_catalog"&&f.volatility==="i"),
      "all expression functions/operators are immutable PostgreSQL builtins: "+spec.name);
    evidence.push({constraint:spec.name,table:spec.table,conclusion:"SEMANTICALLY_EQUIVALENT_FOR_THESE_BUILTIN_EXPRESSIONS",
      comparisonRule:"Retain raw SQL and native trees. Separate analytical tree removes only :location and flattens associative AND; preserves all typed leaf fields and order.",
      variants:observed,functionCatalog});
  }
  r.check(r.json("postgres",`WITH v(x) AS (VALUES(true),(false),(NULL::boolean))
    SELECT jsonb_build_object('n',count(*),'ok',bool_and(((a.x AND b.x) AND c.x) IS NOT DISTINCT FROM (a.x AND (b.x AND c.x))))
      FROM v a CROSS JOIN v b CROSS JOIN v c;`,"native-three-valued-AND").ok,"native three-valued AND associativity: all 27 truth triples");
  return evidence;
}
