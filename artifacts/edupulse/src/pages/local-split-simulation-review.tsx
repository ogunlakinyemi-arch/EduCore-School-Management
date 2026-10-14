import { useEffect, useRef } from 'react';
import type { LocalFlutterwaveSplitSimulation } from '@workspace/api-client-react';
import { Button, money } from '@/components/shared';

export function LocalSplitSimulationReview({
  fixture, pending, acknowledged, onConfirm, onClose,
}: {
  fixture: LocalFlutterwaveSplitSimulation;
  pending: boolean;
  acknowledged: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);

  return (
    <section id="simulation-review-panel" role="region" aria-labelledby="simulation-review-heading"
      data-testid="simulation-review-panel"
      className="min-w-0 space-y-4 rounded-xl border-2 border-amber-500 bg-[hsl(var(--card))] p-4 text-base leading-relaxed text-[hsl(var(--foreground))] [overflow-wrap:anywhere] sm:p-5"
      onClick={event => event.stopPropagation()}
      onKeyDown={event => event.stopPropagation()}
      onSubmit={event => { event.preventDefault(); event.stopPropagation(); }}>
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:justify-between">
        <h3 id="simulation-review-heading" ref={heading} tabIndex={-1} className="min-w-0 font-bold">
          Review fictional fixture — TEST / NOT REAL
        </h3>
        <Button type="button" variant="outline" className="min-h-11 shrink-0 whitespace-normal"
          onClick={onClose} testId="simulation-review-close">Close review — TEST / NOT REAL</Button>
      </div>
      <p>This panel stays open while you read. Clicking inside or outside it does not close it.</p>
      <dl className="grid min-w-0 gap-2">
        <dt className="font-semibold">Fictional recipient — TEST / NOT REAL</dt>
        <dd>{fixture.fictionalBusiness}</dd>
        <dt className="font-semibold">Fictional contact — TEST / NOT REAL</dt>
        <dd>{fixture.fictionalContact} · {fixture.fictionalPhone}</dd>
        <dt className="font-semibold">Fictional bank/account — TEST / NOT REAL</dt>
        <dd>{fixture.fictionalBank} · {fixture.fictionalBankCode} · {fixture.fictionalAccount}</dd>
      </dl>
      <p>No Partner: total {money(fixture.simulationTotalMinor / 100)}; school {money(fixture.simulationSchoolMinor / 100)};
        {' '}Yetenia platform gross {money(fixture.simulationPlatformGrossMinor / 100)}.</p>
      <p>Provider fees are excluded. This review does not verify ownership, a provider allocation or bank settlement.
        The fixture remains LOCAL_ONLY_UNVERIFIED, never TEST_READY. Operational split settings remain unchanged.</p>
      <p>No Flutterwave call, checkout, payment or webhook is created or sent by this fictional review.</p>
      {fixture.reviewedForSimulation && <p role="status" data-testid="simulation-review-recorded">
        Fictional review recorded — TEST / NOT REAL. Still local-only and unverified.
      </p>}
      <Button type="button" className="min-h-11 w-full whitespace-normal sm:w-auto"
        disabled={pending || !acknowledged || fixture.reviewedForSimulation}
        onClick={onConfirm} testId="simulation-review-confirm">
        {pending ? 'Recording fictional review — TEST / NOT REAL…' : 'Confirm fictional review only — TEST / NOT REAL'}
      </Button>
    </section>
  );
}
