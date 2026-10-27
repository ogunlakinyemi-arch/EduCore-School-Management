import {
  useGetAuthorizedContext, useGetOwnerSubscriptionPaymentRules,
  getGetOwnerSubscriptionPaymentRulesQueryKey,
  createOwnerSubscriptionRuleDraft, editOwnerSubscriptionRuleDraft,
  previewOwnerSubscriptionRuleActivation, activateOwnerSubscriptionRule,
  retireOwnerSubscriptionRule, requestOwnerSubscriptionPaymentAssistance,
  recordOwnerSubscriptionBankVerification,
  accrueOwnerBroCommission,
} from '@workspace/api-client-react';
import {
  SubscriptionPaymentRulesPage,
  type SubscriptionPaymentRulesSnapshot,
} from './subscription-payment-rules';

/** Generated requests reuse the application's authenticated transport. */
export function SubscriptionPaymentRulesContainer() {
  const actorId=useGetAuthorizedContext().data?.user?.id ?? null;
  const query=useGetOwnerSubscriptionPaymentRules({query:{
    enabled:actorId!==null, retry:false, staleTime:0,
    queryKey:[...getGetOwnerSubscriptionPaymentRulesQueryKey(),'actor',actorId],
    refetchOnWindowFocus:false,
  }});
  const snapshot:SubscriptionPaymentRulesSnapshot={
    staffRules:[],broRules:[],audit:[],proposals:[],assistance:[],
    ...((actorId!=null ? query.data : null) as Partial<SubscriptionPaymentRulesSnapshot> | null ?? {}),
    loading:actorId===null || query.isLoading,
    error:query.isError?'Rule management could not load. No changes were made.':null,
  };
  return <SubscriptionPaymentRulesPage
    onAccrueBro={scope=>accrueOwnerBroCommission(scope)}
    snapshot={snapshot}
    onRefresh={()=>query.refetch()}
    onCreateDraft={input=>createOwnerSubscriptionRuleDraft(input)}
    onEditDraft={(id,input)=>editOwnerSubscriptionRuleDraft(id,input)}
    onPreview={async id=>{
      const preview=await previewOwnerSubscriptionRuleActivation(id);
      return {...preview,rule:{...preview.rule,endsAt:preview.rule.endsAt??null,
        nativeRuleId:preview.rule.nativeRuleId??null},
        blocker:preview.blocker??null,previewDigest:preview.previewDigest??null};
    }}
    onActivate={(id,body)=>activateOwnerSubscriptionRule(id,body)}
    onRetire={(id,body)=>retireOwnerSubscriptionRule(id,body)}
    onRequestAssistance={input=>{
      if(input.amountMinor!==320000)throw new Error('Only the proposed ₦3,200 per-term platform amount may be requested. No payment was initiated.');
      return requestOwnerSubscriptionPaymentAssistance({...input,amountMinor:320000});
    }}
    onVerifyBank={(id,body)=>recordOwnerSubscriptionBankVerification(id,body)}
  />;
}
