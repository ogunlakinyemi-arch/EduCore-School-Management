import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import { useGetAuthorizedContext, useGetParentTelegramInvitation, getGetParentTelegramInvitationQueryKey, useCreateParentTelegramInvitation } from '@workspace/api-client-react';
import { validTelegramUrl } from './telegram-url';

export function ParentTelegramDirectory({ parentId, schoolId }: { parentId: number; schoolId: number }) {
  const qc = useQueryClient();
  const isOwner = useGetAuthorizedContext().data?.isPlatformOwner === true;
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [msg, setMsg] = useState('');
  const scope = useRef(`${schoolId}:${parentId}`);
  scope.current = `${schoolId}:${parentId}`;
  useEffect(() => { setOpen(false); setUrl(null); setExpiresAt(null); setMsg(''); }, [schoolId, parentId]);
  useEffect(() => {
    if (!url || expiresAt === null) return;
    const timer = setTimeout(() => { setUrl(null); setMsg('Invitation expired. Generate a new invitation.'); }, Math.max(0, expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [url, expiresAt]);
  const params = { schoolId };
  const q = useGetParentTelegramInvitation(parentId, params, { query: { enabled: open && !isOwner, refetchInterval: open ? 30000 : false, queryKey: getGetParentTelegramInvitationQueryKey(parentId, params) } });
  const create = useCreateParentTelegramInvitation();
  if (isOwner) return null;
  const s = q.data;
  const generate = () => {
    const mine = scope.current;
    setMsg('');
    void create.mutateAsync({ parentId, data: { schoolId } }).then(r => {
      if (scope.current !== mine) return;
      const expiry = new Date(r.expiresAt ?? '').getTime();
      const ok = Number.isFinite(expiry) && expiry > Date.now() ? validTelegramUrl(r.url) : null;
      setUrl(ok); setExpiresAt(ok ? expiry : null); if (!ok) setMsg('Invitation could not be shown. Try again.');
      return qc.invalidateQueries({ queryKey: getGetParentTelegramInvitationQueryKey(parentId, params) });
    }).catch(() => { if (scope.current === mine) setMsg('Could not create an invitation.'); });
  };
  const copy = () => {
    if (!url || !expiresAt || expiresAt <= Date.now()) { setUrl(null); return; }
    if (!navigator.clipboard) { setMsg('Clipboard unavailable. Use the QR code or a supported browser.'); return; }
    void navigator.clipboard.writeText(url).then(() => setMsg('Link copied.'), () => setMsg('Copy failed.'));
  };
  return <div className="text-xs" data-testid={`panel-parent-telegram-${parentId}`}>
    {!open ? <button type="button" className="font-bold underline" data-testid={`button-parent-telegram-${parentId}`} onClick={() => setOpen(true)}>Telegram status</button> : <>
      <p role="status" data-testid={`text-parent-telegram-${parentId}`}>{q.isError ? 'Delivery unavailable. Status could not be checked.' : s ? s.status : 'Loading…'}</p>
      {s && !s.pushAvailable && <p data-testid={`text-parent-telegram-push-${parentId}`}>Push notification unavailable. No SMS fallback is sent.</p>}
      {q.isError && <button type="button" className="font-bold underline" onClick={() => void q.refetch()}>Retry</button>}
      {s?.canInvite && <button type="button" className="mt-1 font-bold underline disabled:opacity-50" data-testid={`button-parent-telegram-generate-${parentId}`} disabled={create.isPending} onClick={generate}>{url || s.status === 'Invitation pending' ? 'Refresh invitation' : 'Generate invitation'}</button>}
      {url && <div className="mt-2 space-y-1" data-testid={`panel-parent-telegram-invite-${parentId}`}>
        <QRCodeSVG value={url} size={112} />
        <button type="button" className="font-bold underline" data-testid={`button-parent-telegram-copy-${parentId}`} onClick={copy}>Copy link</button>
        <p>Shown once. Single use; refreshing revokes the previous one.</p>
      </div>}
      {msg && <p role="alert">{msg}</p>}
    </>}
  </div>;
}
