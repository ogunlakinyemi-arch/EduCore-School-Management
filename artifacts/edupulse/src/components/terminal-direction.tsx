import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Button, Field } from "@/components/shared";

/** Uses the existing authenticated API client; device keys never enter this form. */
type Dir = "ENTRY" | "EXIT" | "ENTRY_EXIT";

export function TerminalDirection({ deviceId }: { deviceId: number }) {
  const cache = useQueryClient();
  const queryKey = ["terminal-direction", deviceId];
  const path = `/api/platform/devices/${deviceId}/terminal-direction`;
  const query = useQuery({
    queryKey,
    queryFn: () => customFetch<{ direction: Dir | null }>(path),
    staleTime: 0,
  });
  const [selection, setSelection] = useState<Dir | "">("");
  const save = useMutation({
    mutationFn: () => customFetch<{ direction: Dir }>(path, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ direction: selection }),
    }),
    onSuccess: async (value) => {
      cache.setQueryData(queryKey, value);
      setSelection("");
      await cache.invalidateQueries({ queryKey });
    },
  });
  return (
    <section className="space-y-3 rounded-xl border p-4">
      <Field label="Vendor terminal direction">
        <select aria-label="Vendor terminal direction" value={selection || query.data?.direction || ""}
          disabled={query.isPending || query.isError || save.isPending}
          onChange={event => setSelection(event.target.value as Dir | "")}>
          <option value="" disabled>Not configured — vendor scans will be rejected</option>
          <option value="ENTRY">School entry</option>
          <option value="EXIT">School exit</option>
          <option value="ENTRY_EXIT">Entry and Exit</option>
        </select>
      </Field>
      <p className="text-xs text-[hsl(var(--muted-foreground))]">
        Fixed direction for CARD_SCAN events. Existing credentials work as Bearer device keys.
        Direction must be configured for the assigned school; scans never blindly alternate.
        Entry and Exit is state-based: before school closing a scan is an entry; after closing, a student currently on campus is recorded as exiting.
      </p>
      {query.isError && <p role="alert">Could not load direction. <button type="button" onClick={() => query.refetch()}>Retry</button></p>}
      {save.isError && <p role="alert">Direction could not be saved. No success was confirmed.</p>}
      {save.isSuccess && !selection && <p role="status">Terminal direction saved.</p>}
      <Button type="button" variant="outline" disabled={!selection || query.isError || save.isPending}
        onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save terminal direction"}</Button>
    </section>
  );
}
