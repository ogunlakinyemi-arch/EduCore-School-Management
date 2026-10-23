import assert from "node:assert/strict";

// Parse PostgreSQL 16's retained pg_node_tree representation, not SQL text.
// Unknown fields are retained. Only source locations and associative AND
// nesting are treated specially in the separate analytical representation.
export function parsePgTree(text) {
  const tokens=text.match(/"(?:\\.|[^"\\])*"|[{}()[\]]|[^\s{}()[\]]+/g)??[];
  let cursor=0;
  function read() {
    const token=tokens[cursor++];
    if(token==="{") {
      const tag=tokens[cursor++],fields={};
      while(tokens[cursor]!=="}") {
        const key=tokens[cursor++];
        assert.ok(key?.startsWith(":"),"expected node field");
        assert.ok(!Object.hasOwn(fields,key),"duplicate node field");
        const values=[];
        while(cursor<tokens.length&&!tokens[cursor].startsWith(":")&&tokens[cursor]!=="}")values.push(read());
        fields[key]=values;
      }
      cursor++;
      return {tag,fields};
    }
    if(token==="("||token==="[") {
      const close=token==="("?")":"]",items=[];
      while(tokens[cursor]!==close) { assert.ok(cursor<tokens.length,"unclosed node list");items.push(read()); }
      cursor++;return {list:token,items};
    }
    assert.ok(token!==undefined&&!["}",")","]"].includes(token),"unexpected end/delimiter");
    return token;
  }
  const result=read();assert.equal(cursor,tokens.length);return result;
}
export function analyticalTree(value) {
  if(typeof value!=="object"||value===null)return value;
  if(value.list)return {...value,items:value.items.map(analyticalTree)};
  const fields=Object.fromEntries(Object.entries(value.fields).filter(([k])=>k!==":location")
    .map(([k,v])=>[k,v.map(analyticalTree)]));
  if(value.tag==="BOOLEXPR"&&fields[":boolop"]?.[0]==="and") {
    const args=fields[":args"];
    assert.equal(args.length,1);assert.equal(args[0].list,"(");
    args[0].items=args[0].items.flatMap(child=>child.tag==="BOOLEXPR"&&child.fields[":boolop"]?.[0]==="and"
      &&Object.keys(child.fields).every(k=>[":boolop",":args"].includes(k))
      ?child.fields[":args"][0].items:[child]);
  }
  return {tag:value.tag,fields};
}
export function extractCheck(createTable,name) {
  const start=createTable.indexOf(`CONSTRAINT "${name}" CHECK`);
  assert.ok(start>=0,"missing exact original CHECK "+name);
  const check=createTable.indexOf("CHECK",start),open=createTable.indexOf("(",check);
  let depth=0,quote=false;
  for(let i=open;i<createTable.length;i++) {
    const c=createTable[i];
    if(c==="'") { if(quote&&createTable[i+1]==="'"){i++;continue;}quote=!quote; }
    if(quote)continue;
    if(c==="(")depth++;
    if(c===")"&&--depth===0)return createTable.slice(check,i+1);
    // Only a closing parenthesis decrements the nesting depth.
    if(c!==")")continue;
  }
  throw new Error("Unclosed CHECK "+name);
}
