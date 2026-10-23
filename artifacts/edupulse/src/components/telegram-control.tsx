import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import { validTelegramUrl } from './telegram-url';
import { notificationErrorClass, telegramCheckError, telegramReasons } from './notification-errors';
import { useGetAuthorizedContext, useGetTelegramStatus, getGetTelegramStatusQueryKey, useCheckTelegramHealth, useCreateTelegramLink, useConfirmTelegramLink, useUnlinkTelegram } from '@workspace/api-client-react';

export function telegramGate(s?: { ready: boolean; policyAllowed: boolean; linked: boolean; consented: boolean; parentEligible: boolean }) {
  return !!s && s.parentEligible && s.ready && s.policyAllowed && s.linked && s.consented;
}

export function ParentTelegramControl({ schoolId }: { schoolId: number }) {
  const qc = useQueryClient();
  const params = { schoolId };
  const key = getGetTelegramStatusQueryKey(params);
  const [consent, setConsent] = useState(false);
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [msg, setMsg] = useState('');
  const scope = useRef(schoolId);
  scope.current = schoolId;
  const ifCurrent = (fn: () => void) => { if (scope.current === schoolId) fn(); };
  const [confirmConsent, setConfirmConsent] = useState(false);
  useEffect(() => { setConsent(false); setConfirmConsent(false); setLink(null); setMsg(''); }, [schoolId]);
  useEffect(() => {
    if (!link) return;
    const expiry = new Date(link.expiresAt).getTime();
    const timer = setTimeout(() => { setLink(null); setMsg('Invitation expired. Connect again to create a new link.'); }, Math.max(0, Number.isFinite(expiry) ? expiry - Date.now() : 0));
    return () => clearTimeout(timer);
  }, [link]);
  const ctx = useGetAuthorizedContext().data;
  const parentRole = ctx?.isPlatformOwner !== true && !!ctx?.roles?.some(r => r.role === 'PARENT' && r.status === 'ACTIVE');
  const q = useGetTelegramStatus(params, { query: { queryKey: key, refetchInterval: link ? 4000 : 15000 } });
  const create = useCreateTelegramLink();
  const confirm = useConfirmTelegramLink();
  const unlink = useUnlinkTelegram();
  const s = q.data;
  useEffect(() => { setConfirmConsent(false); }, [s?.pending, s?.pendingAccountLabel, s?.invitationOnly]);
  const refresh = () => qc.invalidateQueries({ queryKey: getGetTelegramStatusQueryKey() });
  const fail = (m: string) => () => ifCurrent(() => setMsg(m));
  const busy = create.isPending || confirm.isPending || unlink.isPending;
  let state = 'Loading Telegram status…';
  if (q.isError) state = 'Telegram status is unavailable right now.';
  else if (s && !parentRole) state = 'Telegram linking is only for signed-in parents of this school.';
  else if (s) state = s.linked && s.consented ? 'Telegram linked.' : s.invitationOnly ? 'School invitation received. For security, create your personal link below, then start the bot with that link and return to confirm.' : s.pending ? 'Link pending: confirm below once you have started the bot chat.'
    : !s.parentEligible ? 'Telegram linking is only for signed-in parents.' : !s.configured ? 'Telegram is disabled: not configured.'
    : !s.ready ? `Telegram is unavailable: ${s.reason}` : !s.policyAllowed ? 'Telegram is blocked by Owner or school settings.' : 'Not linked.';
  const canStart = parentRole && !!s && s.parentEligible && s.ready && s.policyAllowed && !s.linked;
  return <section className="panel p-5" aria-label="Telegram" data-testid="panel-telegram">
    <div className="eyebrow">Telegram</div>
    <p className={q.isError || (s && !s.ready) ? notificationErrorClass : 'mt-2 text-sm'} role={q.isError || (s && !s.ready) ? 'alert' : 'status'} data-testid="text-telegram-state">{state}</p>
    {s?.pending && s.pendingAccountLabel && <p className="mt-1 text-sm" data-testid="text-telegram-pending">Waiting to confirm Telegram account: {s.pendingAccountLabel}</p>}
    {q.isError && <button type="button" className="mt-2 text-xs font-bold underline" onClick={() => void q.refetch()}>Retry</button>}
    {canStart && (!s?.pending || s.invitationOnly) && <>
      <label className="mt-3 flex items-start gap-2 text-sm"><input type="checkbox" data-testid="checkbox-telegram-consent" checked={consent} onChange={e => setConsent(e.target.checked)} />
        <span>I agree to receive Telegram messages about my verified linked children only, subject to current Owner and school settings. I can withdraw at any time.</span></label>
      <button type="button" data-testid="button-telegram-start" className="mt-3 min-h-11 rounded-lg border px-4 disabled:opacity-50" disabled={!consent || busy}
         onClick={() => void create.mutateAsync({ data: { schoolId, consent: true } }).then(r => { ifCurrent(() => { const u = validTelegramUrl(r.url); setLink(u ? { url: u, expiresAt: r.expiresAt } : null); setMsg(u ? '' : 'Could not create a link.'); }); return refresh(); }).catch(fail('Could not create a link.'))}>Connect Telegram</button></>}
    {link && <div className="mt-3 space-y-2 text-sm"><p>Open the bot and press Start in a private chat (valid ten minutes, single use). The bot sends no messages; return here to review and confirm. Optionally sharing your Telegram contact only adds phone matching; it never signs you in.</p>
      <a data-testid="link-telegram-bot" href={link.url} target="_blank" rel="noreferrer noopener" className="font-bold underline">Open Telegram</a>
      <div data-testid="qr-telegram"><QRCodeSVG value={link.url} size={128} /></div></div>}
    {s?.pending && parentRole && s.parentEligible && s.ready && s.policyAllowed && <div className="mt-3 text-sm">
      {s.schoolName && <p data-testid="text-telegram-school">School: {s.schoolName}</p>}
      {!!s.children?.length && <p data-testid="text-telegram-children">Children: {s.children.join(', ')}</p>}
      {s.phoneCheck && <p role={s.phoneCheck === 'MATCH' ? 'status' : 'alert'} className={s.phoneCheck === 'MATCH' ? '' : notificationErrorClass} data-testid="text-telegram-phone">{s.phoneCheck === 'MATCH' ? 'Shared phone matches your record.' : 'Shared phone does not match your record. Confirmation is disabled.'}</p>}
      {!s.invitationOnly && <label className="mt-2 flex items-start gap-2"><input type="checkbox" data-testid="checkbox-telegram-confirm-consent" checked={confirmConsent} onChange={e => setConfirmConsent(e.target.checked)} />
        <span>I consent to Telegram messages about my verified linked children, subject to each school's current permissions. I can withdraw at any time.</span></label>}</div>}
    {s?.pending && !s.invitationOnly && parentRole && s.parentEligible && s.ready && s.policyAllowed && <button type="button" data-testid="button-telegram-confirm" className="mt-3 min-h-11 rounded-lg border px-4 disabled:opacity-50" disabled={busy || !confirmConsent || s.phoneCheck === 'MISMATCH'}
      onClick={() => void confirm.mutateAsync({ data: { schoolId, consent: true } }).then(() => { ifCurrent(() => { setLink(null); setMsg(''); }); return refresh(); }).catch(fail('Could not confirm yet. Start the bot chat first.'))}>Confirm this Telegram account</button>}
    {s && (s.linked || s.pending || s.consented) && <button type="button" data-testid="button-telegram-unlink" className="mt-3 ml-2 min-h-11 rounded-lg border px-4 disabled:opacity-50" disabled={busy}
      onClick={() => void unlink.mutateAsync().then(() => { ifCurrent(() => { setLink(null); setConsent(false); setMsg(''); }); return refresh(); }).catch(fail('Could not unlink.'))}>Unlink and withdraw consent</button>}
    {msg && <p role="alert" className={notificationErrorClass}>{msg}</p>}
  </section>;
}

export function OwnerTelegramHealth() {
  const check = useCheckTelegramHealth();
  const s = check.data;
  return <section className="panel mb-6 space-y-2 p-5" aria-label="Telegram health" data-testid="panel-telegram-health">
    <h2 className="display-font text-xl font-bold">Telegram bot configuration</h2>
    <p className="text-sm">This check calls Telegram getMe and getWebhookInfo only. It never sends a message and does not prove delivery.</p>
    <button type="button" data-testid="button-telegram-health" className="min-h-11 rounded-lg border px-4 disabled:opacity-50" disabled={check.isPending} onClick={() => check.mutate()}>Check bot configuration</button>
    {check.isError && <p role="alert" className={notificationErrorClass}>{telegramCheckError(check.error)}</p>}
    {s && !check.isError && !check.isPending && s.diagnosticOk !== undefined &&
      <p role={s.diagnosticOk ? 'status' : 'alert'} className={s.diagnosticOk ? 'text-sm' : notificationErrorClass} data-testid="text-telegram-diagnostic">
        {s.diagnosticOk ? 'Bot identity and webhook checks passed. No message was sent; delivery is checked separately.'
          : (telegramReasons[s.diagnosticReason ?? ''] ?? telegramReasons.BOT_UNAVAILABLE)}
      </p>}
    {s && !check.isError && !check.isPending && <p role={s.ready ? 'status' : 'alert'} className={s.ready ? 'text-sm' : notificationErrorClass} data-testid="text-telegram-health">
      {s.ready ? 'Delivery configuration is ready. Notifications still require consent and current school permissions; this does not prove receipt.' :
        (Object.hasOwn(telegramReasons, s.reason) ? telegramReasons[s.reason] : telegramReasons.BOT_UNAVAILABLE)}</p>}
  </section>;
}
