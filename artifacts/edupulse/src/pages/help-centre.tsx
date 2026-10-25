import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { BookOpen, ChevronDown, FileText, GraduationCap, Handshake, LifeBuoy, Printer, Search, Users, X, Zap } from 'lucide-react';
import { helpManuals, helpFaqs, helpReviewed } from '@/lib/help-content';

type Aud = 'schools' | 'partners' | 'teachers-staff';
const icons = { schools: GraduationCap, partners: Handshake, 'teachers-staff': Users } as const;
const cx = (...p: Array<string | false | undefined>) => p.filter(Boolean).join(' ');

export function HelpCentrePage() {
  const [role, setRole] = useState<Aud | 'all'>('all');
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const q = query.trim().toLowerCase();
  const hit = (...t: Array<string | undefined>) => !q || t.some(x => x?.toLowerCase().includes(q));

  const manuals = useMemo(() => helpManuals
    .filter(m => role === 'all' || m.id === role)
    .map(m => ({
      ...m,
      sections: m.sections.filter(s => hit(s.title, s.summary, s.appliesTo, ...s.steps, ...(s.notes ?? []))),
    })).filter(m => m.sections.length > 0),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [role, q]);
  const faqs = useMemo(() => helpFaqs.filter(f => (role === 'all' || f.audiences.includes(role)) && hit(f.question, f.answer)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [role, q]);
  const empty = manuals.length === 0 && faqs.length === 0;
  const reset = () => { setQuery(''); setRole('all'); };
  const toggle = (id: string) => setOpenId(c => c === id ? null : id);

  return (
    <div className="app-shell min-h-[100dvh] text-[hsl(var(--foreground))]">
      <header className="bg-[hsl(var(--sidebar))] px-5 py-4 text-[hsl(var(--sidebar-foreground))]">
        <div className="mx-auto flex max-w-5xl items-center gap-2.5">
          <Link href="/" aria-label="Open Yetenia EduCore" className="flex min-h-11 items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]"><Zap size={18} strokeWidth={2.6} /></span>
          <span className="display-font text-xl font-bold">Yetenia EduCore</span>
          </Link>
          <span className="ml-auto text-xs font-bold uppercase tracking-[.15em] opacity-70">Help Centre</span>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-5 py-10">
        <div className="eyebrow mb-2">Help Centre · Reviewed {helpReviewed}</div>
        <h1 className="display-font text-3xl font-bold md:text-5xl" data-testid="heading-help-centre">Guides for every role</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">Step-by-step guides for schools, partners and teachers and staff. Choosing a role only filters what you read; it does not change what you can access.</p>

        <div className="panel mt-8 grid gap-4 p-5">
          <div>
            <label htmlFor="help-search" className="eyebrow mb-2 block">Search guides and FAQs</label>
            <div className="relative">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
               <input id="help-search" type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Try a task or keyword" className="w-full !pl-9" data-testid="input-help-search" />
            </div>
          </div>
          <div role="group" aria-label="Filter by role" className="flex flex-wrap gap-2">
            {([['all', 'All guides'], ...helpManuals.map(m => [m.id, m.audienceLabel])] as [string, string][]).map(([id, label]) => (
              <button key={id} type="button" aria-pressed={role === id} onClick={() => setRole(id as Aud | 'all')} data-testid={`button-role-${id}`}
                className={cx('rounded-xl border px-3.5 py-2 text-sm font-bold outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
                  role === id ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]' : 'border-[hsl(var(--border))] bg-[hsl(var(--card))] hover:border-[hsl(var(--primary)/.4)]')}>{label}</button>
            ))}
          </div>
        </div>

        <section aria-labelledby="manuals-h" className="mt-8 rounded-2xl border border-[hsl(var(--accent)/.5)] bg-[hsl(var(--accent)/.1)] p-5">
          <h2 id="manuals-h" className="flex items-center gap-2 font-bold"><Printer size={18} />Printable manuals and PDF</h2>
          <p className="mt-2 text-sm leading-relaxed">Open a complete manual, then use your browser's Print command (Ctrl+P, or Cmd+P on Mac) and choose Save as PDF as the destination. Nothing is downloaded automatically.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {helpManuals.map(m => { const I = icons[m.id]; return (
              <Link key={m.id} href={`/help/manuals/${m.id}`} data-testid={`link-manual-${m.id}`} className="inline-flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3.5 py-2 text-sm font-bold outline-none hover:border-[hsl(var(--primary)/.4)] focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"><I size={15} />{m.title}<FileText size={14} className="opacity-50" /></Link>
            ); })}
          </div>
        </section>

        {empty && (
          <div className="panel mt-8 flex flex-col items-center p-10 text-center" role="status" data-testid="empty-help">
            <LifeBuoy size={28} className="mb-3 text-[hsl(var(--primary))]" />
            <h2 className="display-font text-2xl font-bold">Nothing matches that search</h2>
            <p className="mt-2 max-w-sm text-sm text-[hsl(var(--muted-foreground))]">Try a shorter keyword, or reset to see every guide again.</p>
            <button type="button" onClick={reset} data-testid="button-reset-help" className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-4 py-2.5 text-sm font-bold text-[hsl(var(--primary-foreground))]"><X size={15} />Reset search and filters</button>
          </div>
        )}

        {manuals.map(m => { const I = icons[m.id]; return (
          <section key={m.id} aria-labelledby={`g-${m.id}`} className="mt-10" data-testid={`section-guide-${m.id}`}>
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[hsl(var(--primary)/.1)] text-[hsl(var(--primary))]"><I size={20} /></span>
              <div className="min-w-0 flex-1"><h2 id={`g-${m.id}`} className="display-font text-2xl font-bold">{m.title}</h2><p className="text-sm text-[hsl(var(--muted-foreground))]">{m.subtitle}</p></div>
              <Link href={`/help/manuals/${m.id}`} className="text-sm font-bold text-[hsl(var(--primary))] underline-offset-4 hover:underline">Full printable manual</Link>
            </div>
            <div className="space-y-3">
              {m.sections.map(s => { const key = `${m.id}:${s.id}`; const open = openId === key || !!q; return (
                <div key={key} className="panel overflow-hidden">
                  <button type="button" aria-expanded={open} aria-controls={`p-${key}`} onClick={() => toggle(key)} className="flex w-full items-start gap-3 p-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[hsl(var(--ring))]">
                    <BookOpen size={17} className="mt-0.5 shrink-0 text-[hsl(var(--muted-foreground))]" />
                    <span className="min-w-0 flex-1"><span className="block font-bold">{s.title}</span><span className="mt-0.5 block text-sm text-[hsl(var(--muted-foreground))]">{s.summary}</span></span>
                    <ChevronDown size={16} className={cx('mt-1 shrink-0 transition-transform', open && 'rotate-180')} />
                  </button>
                  {open && (
                    <div id={`p-${key}`} className="border-t border-[hsl(var(--border))] px-5 py-4 text-sm leading-relaxed">
                      {s.appliesTo && <p className="mb-3 text-xs font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Applies to: {s.appliesTo}</p>}
                      <ol className="list-decimal space-y-2 pl-5">{s.steps.map((t, i) => <li key={i}>{t}</li>)}</ol>
                      {s.notes && s.notes.length > 0 && <ul className="mt-4 list-disc space-y-1 rounded-xl bg-[hsl(var(--muted))] py-3 pl-8 pr-4">{s.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
                      {s.links && s.links.length > 0 && <div className="mt-4 flex flex-wrap gap-3">{s.links.map(l => <Link key={l.href + l.label} href={l.href} className="font-bold text-[hsl(var(--primary))] underline-offset-4 hover:underline">{l.label}</Link>)}</div>}
                    </div>
                  )}
                </div>
              ); })}
            </div>
          </section>
        ); })}

        {faqs.length > 0 && (
          <section aria-labelledby="faq-h" className="mt-12" data-testid="section-faqs">
            <h2 id="faq-h" className="display-font mb-4 text-2xl font-bold">FAQs and troubleshooting</h2>
            <div className="space-y-3">
              {faqs.map((f, i) => { const key = `faq:${i}:${f.question}`; const open = openId === key || !!q; return (
                <div key={key} className="panel">
                  <button type="button" aria-expanded={open} onClick={() => toggle(key)} className="flex w-full items-center gap-3 p-4 text-left font-bold outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[hsl(var(--ring))]">
                    <span className="flex-1">{f.question}</span><ChevronDown size={16} className={cx('shrink-0 transition-transform', open && 'rotate-180')} />
                  </button>
                  {open && <p className="border-t border-[hsl(var(--border))] px-5 py-4 text-sm leading-relaxed">{f.answer}</p>}
                </div>
              ); })}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

export default HelpCentrePage;
