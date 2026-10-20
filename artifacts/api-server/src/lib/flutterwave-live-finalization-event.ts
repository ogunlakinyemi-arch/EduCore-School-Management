import { LiveFinalizationBlocked } from "./flutterwave-live-verification";

function fail(): never { throw new LiveFinalizationBlocked("LIVE_EVENT_REQUIRES_RECONCILIATION"); }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  return value as Record<string, unknown>;
}
function minor(value: unknown): number {
  if (typeof value !== "string" && typeof value !== "number") return fail();
  const parts = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!parts) return fail();
  const result = BigInt(parts[1]!) * 100n + BigInt((parts[2] ?? "").padEnd(2, "0"));
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) return fail();
  return Number(result);
}

/** Parse the ORIGINAL bytes bound to an authenticated inbox fingerprint.
 * Diagnostic inbox claims alone never supply processing/replay authority.
 */
export function parseLiveFinalizationEvent(rawBody: Buffer) {
  let event: Record<string, unknown>;
  try { event = record(JSON.parse(rawBody.toString("utf8"))); } catch { return fail(); }
  const standalone = event.event === undefined && event.data === undefined
    && event.TransactionId !== undefined && event.AmountRefunded !== undefined;
  const type = standalone ? "refund.notification" : event.event;
  const data = standalone ? event : record(event.data);
  const successful = type === "charge.completed" && data.status === "successful";
  const adverse = standalone || type === "refund.completed"
    || typeof type === "string" && /^chargeback\.(initiated|accepted|declined|lost|won|reversed)$/.test(type)
    || type === "charge.completed" && ["failed", "refunded", "reversed"].includes(String(data.status));
  if (!successful && !adverse) return fail();
  if (standalone && (typeof data.status !== "string" || !["completed", "pending", "failed", "successful"].includes(data.status))) return fail();
  const identifiers = [data.id, data.TransactionId].filter(value => value !== undefined);
  if (!identifiers.length || identifiers.some(value =>
    !["string", "number"].includes(typeof value) || !/^[1-9][0-9]{0,15}$/.test(String(value))
      || BigInt(String(value)) > BigInt(Number.MAX_SAFE_INTEGER))
    || identifiers.some(value => String(value) !== String(identifiers[0]))) return fail();
  const reference = data.tx_ref;
  if (reference !== undefined && (typeof reference !== "string" || !/^SCV3_[A-Za-z0-9_-]{8,95}$/.test(reference))) return fail();
  if (successful && reference === undefined) return fail();
  const providerReferences = [data.flw_ref, data.FlwRef].filter(value => value !== undefined);
  if (providerReferences.some(value => typeof value !== "string" || value.length < 1 || value.length > 200)
    || providerReferences.some(value => value !== providerReferences[0])) return fail();
  if (successful && (data.currency !== "NGN" || minor(data.amount) !== 500000)) return fail();
  if (adverse) {
    if (data.currency !== undefined && data.currency !== "NGN") return fail();
    if (type === "charge.completed" && data.amount !== undefined && minor(data.amount) !== 500000) return fail();
    if (standalone || type === "refund.completed") {
      const amount = minor(data.AmountRefunded ?? data.amount);
      if (amount <= 0 || amount > 500000) return fail();
    }
  }
  return {
    kind: successful ? "COLLECTION" as const : "ADVERSE_HOLD" as const,
    transactionId: String(identifiers[0]),
    reference: typeof reference === "string" ? reference : null,
    providerReference: typeof providerReferences[0] === "string" ? providerReferences[0] : null,
  };
}
