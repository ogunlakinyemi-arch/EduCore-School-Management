import { describe, expect, it } from 'vitest';
import { eligibleFeeAssignmentStudents } from './fee-assignment-eligibility';
const classes=[{id:571,schoolId:1393,name:'SS 1'},{id:538,schoolId:1393,name:'Prep 1'}];
const structure={schoolId:1393,classId:571,section:'Science'};
const pupils=[
  {id:721,schoolId:1393,className:'Primary 1',section:'A'},
  {id:730,schoolId:1393,className:'Prep 1',section:'A'},
];
describe('invoice assignment student identifiers and eligibility',()=>{
  it('does not offer Mercyland Primary/Prep pupils for the SS1 Science structure',()=>{
    expect(eligibleFeeAssignmentStudents(pupils,classes,structure,1393)).toEqual([]);
  });
  it('uses the canonical student ID for a matching structure',()=>{
    expect(eligibleFeeAssignmentStudents(pupils,classes,{...structure,classId:538,section:'A'},1393).map(s=>s.id)).toEqual([730]);
  });
  it('rejects a different section',()=>{
    expect(eligibleFeeAssignmentStudents([{...pupils[0],className:'SS 1',section:'Commercial'}],classes,structure,1393)).toEqual([]);
  });
  it('preserves the existing all-section policy for an unrestricted structure',()=>{
    expect(eligibleFeeAssignmentStudents([{...pupils[0],className:'SS 1',section:'Commercial'}],classes,{...structure,section:null},1393)).toHaveLength(1);
  });
  it('rejects a foreign-school student even when class/section match',()=>{
    expect(eligibleFeeAssignmentStudents([{...pupils[0],schoolId:1496,className:'SS 1',section:'Science'}],classes,structure,1393)).toEqual([]);
  });
  it('rejects a foreign-school class',()=>{
    expect(eligibleFeeAssignmentStudents(pupils,[{id:571,schoolId:1496,name:'Primary 1'}],structure,1393)).toEqual([]);
  });
  it('rejects a stale structure after switching schools',()=>{
    expect(eligibleFeeAssignmentStudents(pupils,classes,structure,1496)).toEqual([]);
  });
  it('does not guess eligibility when the structure class is missing',()=>{
    expect(eligibleFeeAssignmentStudents(pupils,[],structure,1393)).toEqual([]);
  });
});