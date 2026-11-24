// Presentation/selection policy only; authorization and QR revocation MUST be server-side.
export const isWithdrawn=student=>student?.enrollmentStatus==='withdrawn';
export function canReceiveLesson(student,date){
 if(!student)return false;
 if(student.enrollmentStatus==null||student.enrollmentStatus==='active')return true;
 if(!isWithdrawn(student)||!/^\d{4}-\d{2}-\d{2}$/.test(student.withdrawnOn||''))return false;
 return Boolean(date&&date<student.withdrawnOn);
}
