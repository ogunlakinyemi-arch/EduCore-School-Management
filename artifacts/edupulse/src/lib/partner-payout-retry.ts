export type PayoutDraft = {
  idempotencyKey: string;
  partnerId: number;
  amount: string;
  currency: string;
};
const storageKey = (actorId: number) => `educore:partner-payout-request:${actorId}`;

export function readPayoutDraft(storage: Storage, actorId: number): PayoutDraft | null {
  const raw = storage.getItem(storageKey(actorId));
  if (!raw) return null;
  const draft = JSON.parse(raw) as PayoutDraft;
  if (!draft || !/^[A-Za-z0-9_-]{8,100}$/.test(draft.idempotencyKey) ||
      !Number.isSafeInteger(draft.partnerId) || draft.partnerId < 1 ||
      typeof draft.amount !== "string" || !/^\d{1,10}(\.\d{1,2})?$/.test(draft.amount) ||
      typeof draft.currency !== "string" || !/^[A-Z]{3}$/.test(draft.currency)) {
    throw new Error("Saved payout request is invalid; review existing payouts before clearing it");
  }
  return draft;
}

export function savePayoutDraft(storage: Storage, actorId: number, draft: PayoutDraft) {
  storage.setItem(storageKey(actorId), JSON.stringify(draft));
}

export function clearPayoutDraft(storage: Storage, actorId: number) {
  storage.removeItem(storageKey(actorId));
}
