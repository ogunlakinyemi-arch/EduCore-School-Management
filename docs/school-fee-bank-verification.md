# School-fee transfer beneficiary verification

These destinations are for school fees paid directly to schools. They do not
configure EduCore subscription collections, merchant settlement, splits,
subaccounts, provider transfers or commission entitlements.

## Verification and enablement

- Only the active School Admin for the requested school may request a lookup,
  save a destination or enable parent instructions. Owner oversight and
  accountant reads do not confer this authority.
- The supported-bank directory and the same dedicated LIVE account-resolution
  guard/provider contract used by Owner/BRO verification are reused. Development
  and Sandbox cannot establish real bank verification. No real provider lookup
  was authorized or performed during implementation.
- The canonical registered/official name is the school's saved `schools.name`.
  Comparison permits ASCII case and whitespace normalization, treating periods,
  commas, hyphens and straight apostrophes as word separators. ASCII digits are
  retained. At least two words must match exactly in order. No fuzzy comparison,
  reordering, missing/extra names, abbreviation expansion, transliteration,
  legal-suffix removal, personal-account substitution or aliases are allowed.
  Unsupported names fail closed; they are not silently rewritten.
- Evidence is encrypted/authenticated with a separate school-fee purpose and
  lasts five minutes. It binds the actor, school, exact official name,
  destination fields and saved settings revision. A school/BRO/Owner token is
  not interchangeable with another purpose or identity.
- Saving locks the settings and school identity, revalidates the bank directory
  and checks proof again after that potentially slow operation. Concurrent bank
  or identity edits invalidate the pending evidence. Initial empty settings are
  handled without treating their transaction-local initialization as a prior
  concurrent saved bank.
- Editing bank/account clears client evidence. Refreshing, typing a name,
  saving an old record, or checking Enable alone cannot verify. A separately
  saved verified destination can remain disabled. Enabling it requires fresh
  evidence again. Disabling needs no lookup and preserves the stored history.

## Parent disclosure and history

Routine settings responses contain only a masked number. Legacy complete or
enabled rows are not verification evidence. Parent invoice instructions and
bank-transfer availability require current official-name matching, a matching
verification audit fingerprint and explicit school enablement. A renamed school
must reverify. Full numbers are disclosed only in authorized enabled invoice
instructions where parents need them to make a transfer.

Audit entries retain actor/school and verification policy/identity/fingerprint,
not full account numbers or tokens. Existing payment, receipt and destination
history is not rewritten or deleted. No schema changes or data backfills are
required. Failures do not replace the saved destination.

## Development verification

Focused tests use synthetic account data, mocked provider transport and no
application database writes. They cover conservative matching, proof binding,
expiry, Development denial, provider/directory mismatch, School Admin authority,
routine masking, legacy denial and shared Owner/BRO safeguards. A real operational
lookup remains deliberately untested and requires separate explicit authorization
on an independently verified LIVE target.
