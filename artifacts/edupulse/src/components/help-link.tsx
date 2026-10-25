import { BookOpen } from 'lucide-react';
import { Link } from 'wouter';

/** Shared, session-independent help entry for the main and BRO navigation. */
export function HelpLink({ className = '', onClick }: { className?: string; onClick?: () => void }) {
  return <Link href="/help" onClick={onClick} data-testid="link-help-centre"
    className={`inline-flex min-h-11 items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] ${className}`}>
    <BookOpen size={17} aria-hidden="true" /><span>Help Centre</span>
  </Link>;
}
