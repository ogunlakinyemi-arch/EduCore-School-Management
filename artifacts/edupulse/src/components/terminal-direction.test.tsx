// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@workspace/api-client-react", () => ({ customFetch: fixture.request }));
vi.mock("@/components/shared", () => ({
  Button: ({ variant: _variant, children, ...props }: any) => <button {...props}>{children}</button>,
  Field: ({ label, children }: any) => <label>{label}{children}</label>,
}));
import { TerminalDirection } from "./terminal-direction";

let node: HTMLDivElement;
let root: Root;
let client: QueryClient;
async function settle() {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); });
}
async function render(deviceId = 100) {
  await act(async () => {
    root.render(<QueryClientProvider client={client}><TerminalDirection deviceId={deviceId} /></QueryClientProvider>);
  });
  await settle();
}
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  node = document.createElement("div"); document.body.appendChild(node);
  root = createRoot(node);
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  fixture.request.mockReset();
  fixture.request.mockResolvedValue({ direction: null });
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear(); node.remove();
});

describe("existing device configuration terminal direction control", () => {
  it("shows unconfigured direction without silently assigning entry", async () => {
    await render();
    expect((node.querySelector("select") as HTMLSelectElement).value).toBe("");
    expect((node.querySelector("button") as HTMLButtonElement).disabled).toBe(true);
    expect(fixture.request).toHaveBeenCalledWith("/api/platform/devices/100/terminal-direction");
  });
  it("loads the saved direction, saves an explicit change, and refreshes its query", async () => {
    let saved = "ENTRY";
    fixture.request.mockImplementation(async (_path, options) => {
      if (options?.method === "PUT") saved = JSON.parse(options.body).direction;
      return { direction: saved };
    });
    await render();
    const select = node.querySelector("select") as HTMLSelectElement;
    expect(select.value).toBe("ENTRY");
    await act(async () => { select.value = "EXIT"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => { (node.querySelector("button") as HTMLButtonElement).click(); });
    await settle();
    expect(fixture.request).toHaveBeenCalledWith("/api/platform/devices/100/terminal-direction",
      expect.objectContaining({ method: "PUT", body: '{"direction":"EXIT"}' }));
    expect(select.value).toBe("EXIT");
    expect(node.textContent).toContain("Terminal direction saved");
  });
  it("does not allow saving after a read failure", async () => {
    fixture.request.mockRejectedValue(new Error("read failed"));
    await render();
    expect((node.querySelector("select") as HTMLSelectElement).disabled).toBe(true);
    expect(node.textContent).toContain("Could not load direction");
    expect(fixture.request).toHaveBeenCalledTimes(1);
  });
  it("shows a failed write rather than claiming the direction was saved", async () => {
    fixture.request.mockImplementation(async (_path, options) => {
      if (options?.method === "PUT") throw new Error("write failed");
      return { direction: null };
    });
    await render();
    await act(async () => {
      const select = node.querySelector("select") as HTMLSelectElement;
      select.value = "ENTRY"; select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => { (node.querySelector("button") as HTMLButtonElement).click(); });
    await settle();
    expect(node.textContent).toContain("Direction could not be saved");
    expect(node.textContent).not.toContain("Terminal direction saved");
  });
});
