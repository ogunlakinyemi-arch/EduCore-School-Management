import {useState} from 'react';
import {useAuth} from '@clerk/react';
import {Eye} from 'lucide-react';
import {useGetOfficialCardPreview} from '@workspace/api-client-react';
import {Button,Modal,ErrorState} from './shared';

/** Viewing does not enable the Owner-only printable-file or card-lifecycle actions. */
export function OfficialCardPreview({cardId,schoolId}:{cardId:number;schoolId:number}) {
  const [open,setOpen]=useState(false);
  const {userId}=useAuth();
  const query=useGetOfficialCardPreview(cardId,{schoolId},{
    query:{enabled:open && !!userId,queryKey:['official-card-preview',userId,schoolId,cardId],
      staleTime:0,gcTime:0,refetchOnWindowFocus:true},
  });
  return <>
    <Button variant="outline" onClick={()=>setOpen(true)} testId={`button-preview-nfc-card-${cardId}`}>
      <Eye size={14}/>View ID card
    </Button>
    {open && <Modal title="Official ID card preview" eyebrow="View only · CR80 front and back" onClose={()=>setOpen(false)}>
      {query.isLoading ? <p role="status">Loading the current official card…</p> : query.isError ?
        <ErrorState message="This card preview is unavailable or you do not have permission." retry={()=>query.refetch()}/> :
        query.data && <div className="space-y-4">
          <figure><img src={query.data.frontImage} alt="Front of the current official identification card" className="w-full rounded-md border border-[hsl(var(--border))]" draggable={false}/><figcaption className="mt-1 text-xs">Front</figcaption></figure>
          <figure><img src={query.data.backImage} alt="Back of the current official identification card" className="w-full rounded-md border border-[hsl(var(--border))]" draggable={false}/><figcaption className="mt-1 text-xs">Back</figcaption></figure>
          <p className="text-xs text-[hsl(var(--muted-foreground))]">Preview only. Printable PDF download, printing and official card controls remain Platform Owner-only.</p>
        </div>}
    </Modal>}
  </>;
}