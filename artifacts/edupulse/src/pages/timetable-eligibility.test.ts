import { describe, expect, it } from 'vitest';
import type { AcademicSession, ClassSubjectAssignment, Employee, TeacherClassAssignment } from '@workspace/api-client-react';
import { matchingTimetableTeachers } from './timetable-eligibility';

const selection={schoolId:1,sessionId:2,termId:3,classId:4,section:'B',subjectId:5};
const session={id:2,schoolId:1,name:'2026/2027',startDate:'2026-09-01',endDate:'2027-07-31',status:'ACTIVE'} satisfies AcademicSession;
const employee={id:6,schoolId:1,employeeId:'T006',firstName:'Maths',lastName:'Teacher',type:'TEACHER',status:'ACTIVE'} satisfies Employee;
const subject={id:7,schoolId:1,sessionId:2,termId:3,classId:4,section:'B',subjectId:5,teacherId:6,status:'ACTIVE'} satisfies ClassSubjectAssignment;
const assignment={id:8,schoolId:1,sessionId:2,classId:4,section:'B',subjectId:5,teacherId:6,assignmentType:'SUBJECT_TEACHER',status:'ACTIVE',startDate:'2026-09-01',endDate:null} satisfies TeacherClassAssignment;
const eligible=(s=subject as ClassSubjectAssignment,a=assignment as TeacherClassAssignment)=>
  matchingTimetableTeachers([employee],[s],[a],session,selection);
describe('timetable assignment eligibility',()=>{
  it('accepts the exact same-school term/section/subject teacher',()=>expect(eligible().map(t=>t.id)).toEqual([6]));
  it.each([
    {schoolId:99},{sessionId:99},{termId:99},{classId:99},{section:'C'},{subjectId:99},{teacherId:99},{status:'INACTIVE'},
  ])('rejects mismatched class-subject assignment %j',patch=>expect(eligible({...subject,...patch} as ClassSubjectAssignment)).toEqual([]));
  it.each([
    {schoolId:99},{sessionId:99},{classId:99},{section:'C'},{subjectId:99},{teacherId:99},{status:'INACTIVE'},
    {startDate:'2028-01-01'},{endDate:'2025-01-01'},
  ])('rejects mismatched or out-of-session teacher assignment %j',patch=>expect(eligible(subject,{...assignment,...patch} as TeacherClassAssignment)).toEqual([]));
  it('preserves existing wildcard sections, whole-session terms and unbound subject teachers',()=>{
    expect(eligible({...subject,section:null,termId:null,teacherId:null},{...assignment,section:''})).toHaveLength(1);
  });
  it('preserves authorized class-teacher assignments without bypassing subject teacher binding',()=>{
    expect(eligible(subject,{...assignment,assignmentType:'CLASS_TEACHER',subjectId:null})).toHaveLength(1);
    expect(eligible({...subject,teacherId:99},{...assignment,assignmentType:'CLASS_TEACHER',subjectId:null})).toEqual([]);
  });
  it('handles ISO date values from the actual assignment API',()=>{
    expect(eligible(subject,{...assignment,startDate:'2026-09-01T00:00:00.000Z'})).toHaveLength(1);
  });
});