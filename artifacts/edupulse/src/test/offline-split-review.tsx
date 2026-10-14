/**
 * Isolated browser acceptance entry; not imported by the app or its routes.
 * Pure fictional builder + real review UI only: no auth/API client/transport.
 */
import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LocalSplitSimulationReview } from '../pages/local-split-simulation-review';
import { Button } from '@/components/shared';
import { buildLocalSplitSimulation } from '../../../api-server/src/lib/local-split-simulation';
import '../index.css';

function OfflineReviewAcceptance() {
  const [open, setOpen] = useState(false);
  const [submits, setSubmits] = useState(0);
  const [fixture, setFixture] = useState(() => buildLocalSplitSimulation({
    mode: 'LOCAL_SPLIT_SIMULATION', exampleSchoolId: 1496, action: 'PREVIEW', acknowledgeFictional: false,
  }));
  const opener = useRef<HTMLDivElement>(null);
  return (
    <main className="mx-auto min-w-0 max-w-3xl space-y-5 p-4 sm:p-8">
      <h1 className="text-xl font-bold">TEST / NOT REAL — offline component acceptance</h1>
      <p>No authenticated app session. No backend or external service is used.</p>
      <form className="space-y-5" onSubmit={event => { event.preventDefault(); setSubmits(value => value + 1); }}>
        <div ref={opener}>
          <Button type="button" onClick={() => setOpen(true)} testId="offline-review-open">
            Review fictional fixture — TEST / NOT REAL
          </Button>
        </div>
        {open && <LocalSplitSimulationReview fixture={fixture} pending={false} acknowledged
          onClose={() => { setOpen(false); opener.current?.querySelector('button')?.focus(); }}
          onConfirm={() => setFixture(buildLocalSplitSimulation({
            mode: 'LOCAL_SPLIT_SIMULATION', exampleSchoolId: 1496, action: 'REVIEW', acknowledgeFictional: true,
          }))} />}
        <p data-testid="offline-outside">TEST / NOT REAL — outside the review</p>
        <output data-testid="offline-submit-count">Accidental submissions: {submits}</output>
      </form>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<OfflineReviewAcceptance />);
