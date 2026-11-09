import {describe,it,expect} from "vitest";
import {notificationTime,notificationText} from "../../../../lib/api-zod/src/notification-time";
describe("notification WAT presentation without changing instants",()=>{
  it("converts the reported UTC case to explicit Lagos time",()=>{
    expect(notificationTime("2026-11-09T06:53:59.000Z")).toBe("09 Nov 2026, 07:53:59 WAT");
  });
  it("rolls over the date and year correctly",()=>{
    expect(notificationTime("2026-12-31T23:30:00Z")).toBe("01 Jan 2027, 00:30:00 WAT");
  });
  it("does not double-convert offsets or already formatted text",()=>{
    const display="09 Nov 2026, 07:53:59 WAT";
    expect(notificationTime("2026-11-09T07:53:59+01:00")).toBe(display);
    expect(notificationText(`Event: 2026-11-09T06:53:59.000Z`)).toBe(`Event: ${display}`);
    expect(notificationText(`Event: ${display}`)).toBe(`Event: ${display}`);
    expect(notificationText("School day 2026-11-09")).toBe("School day 2026-11-09");
    expect(notificationTime("invalid")).toBe("—");
  });
});
