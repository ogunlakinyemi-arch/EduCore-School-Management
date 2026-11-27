import {initialStudentFreePeriod,readStudentUsageRollout as readStudentRollout} from "./student-platform-rollout";
export const STAFF_FREE_TERM_POLICY=Object.freeze({
  approvedOn:"2026-10-27",effectiveOn:"2026-10-27",normalPriceMinor:200000,
});
/** Every school-saved term uses the same NFC-only seven-day window. */
export async function readStaffCollection(db:Parameters<typeof readStudentRollout>[0],schoolId:number,termId?:number){
  if(initialStudentFreePeriod())return{chargeable:false,collectionStartDate:null};
  return readStudentRollout(db,schoolId,termId);
}
