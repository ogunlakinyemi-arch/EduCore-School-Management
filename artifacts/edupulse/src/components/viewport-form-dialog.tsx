import { useEffect, useRef, useState, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

function viewportBounds() {
  if (typeof window === 'undefined') return { top: 0, left: 0, height: 0, width: 0 };
  const view = window.visualViewport;
  return { top: view?.offsetTop ?? 0, left: view?.offsetLeft ?? 0,
    height: view?.height ?? window.innerHeight, width: view?.width ?? window.innerWidth };
}

/** Presentation only: the caller retains its form, permissions and save/close handlers. */
export function ViewportFormDialog({ title, eyebrow, children, onClose }: {
  title: string; eyebrow?: string; children: ReactNode; onClose: () => void;
}) {
  const [bounds, setBounds] = useState(viewportBounds);
  const heading = useRef<HTMLHeadingElement>(null);
  const opener = useRef(typeof document === 'undefined' ? null : document.activeElement);
  const scrollArea = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const update = () => setBounds(viewportBounds());
    const view = window.visualViewport;
    view?.addEventListener('resize', update);
    view?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    update();
    return () => {
      view?.removeEventListener('resize', update);
      view?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);
  useEffect(() => {
    const active = document.activeElement;
    if (!scrollArea.current?.contains(active) || !(active instanceof HTMLElement)) return;
    const frame = requestAnimationFrame(() => active.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }));
    return () => cancelAnimationFrame(frame);
  }, [bounds]);

  return <Dialog.Root open onOpenChange={open => { if (!open) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-[hsl(var(--foreground)/.25)] backdrop-blur-sm" />
      <Dialog.Content aria-modal="true" aria-describedby={undefined}
        className="panel fixed z-50 flex min-h-0 min-w-0 max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden shadow-2xl"
        style={{ top: bounds.top + bounds.height / 2, left: bounds.left + bounds.width / 2,
          width: Math.max(0, bounds.width - 32),
          maxHeight: `calc(${bounds.height}px - 2rem - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))` }}
        onOpenAutoFocus={event => { event.preventDefault(); heading.current?.focus({ preventScroll: true }); }}
        onCloseAutoFocus={event => {
          event.preventDefault();
          if (opener.current instanceof HTMLElement && opener.current.isConnected) opener.current.focus({ preventScroll: true });
        }}
        // Preserve the old modal's explicit-close behavior; a stray backdrop tap must not lose a draft.
        onPointerDownOutside={event => event.preventDefault()}>
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[hsl(var(--border))] p-4 md:px-8 md:py-5">
          <div className="min-w-0 break-words">
            {eyebrow && <div className="eyebrow mb-1.5">{eyebrow}</div>}
            <Dialog.Title ref={heading} tabIndex={-1} className="display-font text-2xl font-bold outline-none">{title}</Dialog.Title>
          </div>
          <Dialog.Close type="button" aria-label="Close dialog" data-testid="button-close-dialog"
            className="shrink-0 rounded-xl p-2 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]">
            <X size={20} />
          </Dialog.Close>
        </div>
        <div ref={scrollArea} data-testid="dialog-form-scroll" className="min-h-0 min-w-0 overflow-y-auto overscroll-contain p-4 [overflow-wrap:anywhere] [-webkit-overflow-scrolling:touch] [&_input]:min-w-0 [&_select]:min-w-0 [&_textarea]:min-w-0 md:p-8">
          {children}
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
