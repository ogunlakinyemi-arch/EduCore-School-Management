/** Shared identity check only: never selects credentials, mode or recipients. */
export function collectionSubaccountBankMatches(d:Record<string,unknown>,id:number,bank:{bankCode:string;accountNumber:string}) {
  return Number(d.id)===id&&d.account_number===bank.accountNumber&&String(d.account_bank)===bank.bankCode
    &&typeof d.subaccount_id==="string"&&/^RS_[A-Za-z0-9]{12,80}$/.test(d.subaccount_id);
}
