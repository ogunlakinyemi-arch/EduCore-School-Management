import {describe,expect,it,vi} from "vitest";
vi.mock("@workspace/db",()=>({classifyDatabaseError:()=>({category:"CONNECT_TIMEOUT"})}));
import {databaseReadiness} from "./database-readiness";
describe("database-backed readiness",()=>{
  it("acquires the app connection, reads in a bounded read-only transaction, rolls back and releases",async()=>{
    const query=vi.fn().mockResolvedValue({rows:[{ready:1}]}),release=vi.fn();
    const result=await databaseReadiness({connect:vi.fn().mockResolvedValue({query,release})});
    expect(result.ready).toBe(true);
    expect(query.mock.calls.map(c=>c[0])).toEqual([
      "BEGIN READ ONLY","SET LOCAL statement_timeout='2000ms'","SELECT 1 AS ready","ROLLBACK",
    ]);
    expect(release).toHaveBeenCalledOnce();
  });
  it("does not report ready when acquiring a connection fails or leak raw errors",async()=>{
    const result=await databaseReadiness({connect:vi.fn().mockRejectedValue(new Error("private connection details"))});
    expect(result.ready).toBe(false);
    expect(JSON.stringify(result)).not.toContain("private");
  });
  it("rolls back and discards a broken checked-out client",async()=>{
    const query=vi.fn().mockResolvedValueOnce({rows:[]}).mockRejectedValue(new Error("offline")),release=vi.fn();
    expect((await databaseReadiness({connect:vi.fn().mockResolvedValue({query,release})})).ready).toBe(false);
    expect(release).toHaveBeenCalledWith(true);
  });
  it("never treats an empty or invalid query result as healthy",async()=>{
    const query=vi.fn().mockResolvedValue({rows:[]}),release=vi.fn();
    expect((await databaseReadiness({connect:vi.fn().mockResolvedValue({query,release})})).ready).toBe(false);
    expect(query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
  });
});
