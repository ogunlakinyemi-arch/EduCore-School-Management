import { useEffect } from 'react';
import { Link } from 'wouter';
import { ArrowLeft, Printer, Zap } from 'lucide-react';
import { findHelpManual, helpReviewed } from '@/lib/help-content';
import './help-manual.css';

export function HelpManualPage({ audience }: { audience?: string }) {
  const manual = findHelpManual(audience);
  useEffect(() => {
    const previous = document.title;
    document.title = manual ? `Yetenia EduCore — ${manual.title}` : 'Yetenia EduCore — Manual not found';
    return () => { document.title = previous; };
  }, [manual]);

  if (!manual) return <main className="mx-auto max-w-2xl p-6 py-16">
    <h1 className="display-font text-3xl font-bold">Manual not found</h1>
    <p className="my-4">Choose one of the three verified role guides in the Help Centre.</p>
    <Link href="/help" className="font-bold underline">Return to Help Centre</Link>
  </main>;

  return <main className="help-manual mx-auto max-w-4xl px-5 py-8 sm:px-8" data-testid="help-manual">
    <nav className="help-no-print mb-8 flex flex-wrap items-center justify-between gap-3" aria-label="Manual navigation">
      <Link href="/help" className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-bold hover:underline"><ArrowLeft size={16} />Help Centre</Link>
      <button type="button" onClick={() => window.print()} data-testid="button-print-manual"
        className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-5 py-3 text-sm font-bold text-[hsl(var(--primary-foreground))] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4">
        <Printer size={17} aria-hidden="true" />Print / Save as PDF
      </button>
    </nav>
    <header className="help-cover rounded-3xl bg-[#122039] p-6 text-white sm:p-10">
      <div className="mb-8 flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-[#fbc531] text-[#122039]"><Zap size={22} aria-hidden="true" /></span><span className="display-font text-xl font-bold">Yetenia EduCore</span></div>
      <p className="text-xs font-bold uppercase tracking-widest text-[#fbc531]">{manual.audienceLabel} · Setup and reference</p>
      <h1 className="display-font mt-3 text-3xl font-bold leading-tight sm:text-4xl">{manual.title}</h1>
      <p className="mt-4 max-w-2xl text-sm leading-relaxed text-white/85">{manual.subtitle}</p>
      <p className="mt-6 text-xs text-white/75">Source reviewed {helpReviewed} · Public guide · No account or school data</p>
    </header>
    <aside className="help-no-print my-6 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 text-sm leading-relaxed" aria-label="Saving a PDF">
      <h2 className="font-bold">Keep a copy</h2>
      <p className="mt-2">Select <strong>Print / Save as PDF</strong>, then choose <strong>Save as PDF</strong> as the print destination on a computer. On a phone, use your browser’s Print or Share → Print option and save a PDF where supported. If no PDF option is offered, open this manual in a desktop browser.</p>
      <p className="mt-2">All sections below are included. This opens the browser print dialog; it does not download a PDF automatically. Choose A4 and check the print preview before saving.</p>
    </aside>
    <section className="my-8 rounded-2xl border border-[hsl(var(--border))] p-5" aria-labelledby="manual-contents">
      <h2 id="manual-contents" className="display-font text-xl font-bold">In this manual</h2>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm">
        {manual.sections.map(s => <li key={s.id}><a href={`#${s.id}`} className="font-semibold underline underline-offset-4">{s.title}</a></li>)}
      </ol>
    </section>
    <p className="my-6 text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">This guide describes implemented screens checked in source, not a guarantee that every school, device, integration or payment service is activated. Links require the appropriate signed-in role. Reading a guide does not grant permissions.</p>
    <article className="space-y-9">
      {manual.sections.map((s, index) => <section key={s.id} id={s.id} className="help-manual-section scroll-mt-5 border-t border-[hsl(var(--border))] pt-7" aria-labelledby={`heading-${s.id}`}>
        <p className="text-xs font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Section {index + 1}</p>
        <h2 id={`heading-${s.id}`} className="display-font mt-2 text-2xl font-bold">{s.title}</h2>
        <p className="mt-3 text-sm leading-relaxed">{s.summary}</p>
        {s.appliesTo && <p className="mt-3 text-sm font-semibold">Applies to: {s.appliesTo}</p>}
        <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm leading-relaxed">{s.steps.map((step, i) => <li key={i}>{step}</li>)}</ol>
        {!!s.notes?.length && <ul className="mt-5 list-disc space-y-2 rounded-xl bg-[hsl(var(--muted))] p-4 pl-8 text-sm leading-relaxed">{s.notes.map((note, i) => <li key={i}>{note}</li>)}</ul>}
        {!!s.links?.length && <div className="mt-4 flex flex-wrap gap-x-5 gap-y-3 text-sm">{s.links.map(link => <Link key={link.href} href={link.href} className="font-semibold underline underline-offset-4">{link.label}</Link>)}</div>}
      </section>)}
    </article>
    <footer className="mt-12 border-t border-[hsl(var(--border))] py-6 text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">Yetenia EduCore · {manual.title} · Reviewed {helpReviewed}. Keep credentials and personal records out of support screenshots. Financial setup is not evidence of payment.</footer>
  </main>;
}
