// Period order is part of reservation/availability identity.
export const sameCourseStructure=(a,b)=>Boolean(a&&b&&a.startDate===b.startDate&&a.endDate===b.endDate&&JSON.stringify((a.periods||[]).map(p=>[p.start,p.end]))===JSON.stringify((b.periods||[]).map(p=>[p.start,p.end])));
export function assertCourseStructureEditable({before,value,settings,hasLessons,hasAvailability}){
 if(!before||sameCourseStructure(before,value))return;
 if(settings||hasLessons||hasAvailability)throw Error('関連データ作成後の講習期間・コマ構成は固定です。個別授業の変更は講習予約管理で行ってください。');
}
