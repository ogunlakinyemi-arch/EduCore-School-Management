import assert from "node:assert/strict";
import {readFileSync,readlinkSync} from "node:fs";
import {networkInterfaces} from "node:os";

/** No fallback to TCP denial stubs, application credentials or an app database. */
export function requireIsolatedFinanceFixture(){
 assert.equal(process.env.NODE_ENV,"test","A clean test environment is required");
 assert.notEqual(readlinkSync("/proc/self/ns/net"),readlinkSync("/proc/1/ns/net"),
   "A separately verified no-egress network namespace is required");
 assert.ok(Object.keys(networkInterfaces()).every(name=>name==="lo"),"Non-loopback interface is forbidden");
 assert.equal(readFileSync("/proc/net/route","utf8").trim().split("\n").length,1,"IPv4 routing is forbidden");
 assert.ok(readFileSync("/proc/net/ipv6_route","utf8").trim().split("\n").filter(Boolean)
   .every(line=>line.trim().split(/\s+/).at(-1)==="lo"),"External IPv6 routing is forbidden");
 assert.ok(!Object.keys(process.env).some(name=>/DATABASE|PGHOST|PGPASSWORD|PGSERVICE|TOKEN|SECRET|API_KEY|CLERK|FLUTTERWAVE|RESEND/i.test(name)),
   "Application credentials must not be inherited");
}
