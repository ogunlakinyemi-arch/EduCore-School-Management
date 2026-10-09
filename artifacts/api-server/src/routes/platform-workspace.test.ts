import {describe,expect,it,vi} from "vitest";
vi.mock("@workspace/db",()=>({pool:{}}));
import {exportCsvCell,platformMessageInput,schoolSelection} from "./platform-workspace";
describe("Owner workspace validation and export",()=>{
  it("requires a distinct explicit bounded school audience",()=>{
    for(const schoolIds of [[],[1,1],[0],Array.from({length:51},(_,i)=>i+1)])
      expect(schoolSelection.safeParse({schoolIds}).success).toBe(false);
    expect(schoolSelection.parse({schoolIds:[1,2]}).schoolIds).toEqual([1,2]);
    expect(schoolSelection.safeParse({schoolIds:[1],broadcast:true}).success).toBe(false);
  });
  it("requires meaningful content, a stable submission key and confirmed count",()=>{
    const valid={schoolIds:[1],subject:" Notice ",body:" Body ",idempotencyKey:"stable-request-key-0001",confirmedRecipientCount:1};
    expect(platformMessageInput.parse(valid)).toMatchObject({subject:"Notice",body:"Body"});
    for(const change of [{subject:" "},{body:" "},{body:"x".repeat(5001)},{subject:"x".repeat(161)},{idempotencyKey:"short"},{confirmedRecipientCount:0}])
      expect(platformMessageInput.safeParse({...valid,...change}).success).toBe(false);
  });
  it("quotes CSV and prevents spreadsheet formula execution",()=>{
    expect(exportCsvCell('A "quoted", school')).toBe('"A ""quoted"", school"');
    for(const value of ['=SUM(A1:A2)','+123','-12','@IMPORT',' \t=1','\nformula'])
      expect(exportCsvCell(value)).toBe(`"'${value.replaceAll('"','""')}"`);
    expect(exportCsvCell(null)).toBe('""');
  });
});
