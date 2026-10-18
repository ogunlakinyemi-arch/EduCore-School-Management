/** Response projection only: never mutates immutable financial history. */
export function visibleSubscription<T>(value: T, owner: boolean, ownRecipient?: "SCHOOL" | "PARTNER"): T {
  if (owner) return value;
  const visit = (input: any): any => {
    if (input instanceof Date) return input.toJSON();
    if (Array.isArray(input)) return input
      .filter(item => {
        const recipient = item?.recipientType ?? item?.recipient_type;
        return !recipient || recipient === ownRecipient;
      }).map(visit);
    if (!input || typeof input !== "object") return input;
    return Object.fromEntries(Object.entries(input).filter(([key]) => {
      const normalized = key.replace(/[^a-z]/gi, "").toLowerCase();
      if (/(allocationsnapshot|commissionrule|billingrule|providerfee|settlementamount)/.test(normalized)) return false;
      const party = normalized.match(/^(school|platform|edupulse|partner)(share|amount|allocated|allocation|commission|revenue|expense|fee)/)?.[1];
      return !party || (party === "school" && ownRecipient === "SCHOOL")
        || (party === "partner" && ownRecipient === "PARTNER");
    }).map(([key, child]) => [key, visit(child)]));
  };
  return visit(value);
}
