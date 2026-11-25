"""Wire date-scoped seasonal corrections into the staged QA Hosting UI."""

import argparse
import re
from pathlib import Path


VERSION = 'qa-ranking-correction-20261125-a'
IMPORT = f"import {{askCorrectionReason,lessonEnded}} from './ranking-correction-ui.js?v={VERSION}';\n"
SOURCE_NAMES = ('index.html', 'app.js', 'seasonal-authority-client.js',
                'course-booking-admin.html', 'course-booking-admin.js')


def replace_once(source, old, new):
    if source.count(old) != 1:
        raise ValueError(f'CORRECTION UI ANCHOR MISMATCH {old[:70]}')
    return source.replace(old, new, 1)


def version(source, filename):
    pattern = re.escape(f'./{filename}') + r'(?:\?v=[^"\']*)?'
    changed, count = re.subn(pattern, f'./{filename}?v={VERSION}', source)
    if count != 1:
        raise ValueError(f'CORRECTION UI ASSET MISMATCH {filename}')
    return changed


def update_seasonal_client(source):
    source = replace_once(source, "'capabilities');}\n async function inspectCourse", "'capabilities');return c;}\n async function inspectCourse")
    source = replace_once(source, "inspectCourse(courseId,before,who){const s=await request('inspectCourse',{courseId},who);",
                          "inspectCourse(courseId,before,who,dates=[]){const s=await request('inspectCourse',{courseId,...(dates.length?{correctionDates:dates}:{})},who);")
    source = replace_once(source, "const who=identity();await requireOperation('publishManualCourse',who);",
                          "const who=identity(),capabilities=await requireOperation('publishManualCourse',who);")
    source = replace_once(source, 'const s=await inspectCourse(courseId,beforeCourse,who);const mapped=changes.map', """const records=changes.flatMap(change=>[change.before,change.remove?null:change.value].filter(Boolean));
   const dates=capabilities.rankingDateCorrections===true
     ? [...new Set(records.filter(row=>lessonEnded(row.date,row.end)).map(row=>row.date))]
     : [];
   const s=await inspectCourse(courseId,beforeCourse,who,dates);
   const mapped=changes.map""")
    return IMPORT + replace_once(source, "return request('publishManualCourse',{courseId,expectedCourse:s.course.token,expectedMeta:s.meta.token,changes:mapped},who);", """let correction;
   if(s.correctionDates?.length){
    const [date]=s.correctionDates;
    if(s.correctionDates.length!==1||records.some(row=>row.date!==date||!lessonEnded(row.date,row.end)))throw blocked('事後訂正は終了済みの同じ日付の授業ごとに保存してください。');
    const reason=await askCorrectionReason(date);
    if(!reason)return {cancelled:true};
    correction={date,reason};
   }
   return request('publishManualCourse',{courseId,expectedCourse:s.course.token,expectedMeta:s.meta.token,changes:mapped,...(correction?{correction}:{})},who);""")


BOOKING_HELPERS = """function bookingCorrectionSlot(key){
  const attendance=detail?.correctionAttendance?.[key];
  const slot=detail?.slots?.find(row=>row.id===key);
  return attendance&&slot&&Number.isSafeInteger(detail.revision)?{slot,attendance}:null;
}
function attendanceButtons(key){
  const item=bookingCorrectionSlot(key);
  if(!item)return '';
  if(item.attendance==='cancelled')return badge('欠席')+b('setAttendance:scheduled:'+key,'欠席を解除')+b('setAttendance:done:'+key,'実施済みに戻す');
  return b('setAttendance:cancelled:'+key,'欠席に訂正');
}
async function bookingCorrectionPayload(key){
  const item=bookingCorrectionSlot(key);
  if(!item)return {};
  const selection=detail,epoch=authEpoch;
  const reason=await askCorrectionReason(item.slot.date);
  if(!reason||selection!==detail||epoch!==authEpoch||!canInteract())return null;
  return {expectedRevision:selection.revision,correction:{date:item.slot.date,reason}};
}
"""


def update_booking(source):
    source = replace_once(source, 'function studentDetail(){', BOOKING_HELPERS + 'function studentDetail(){')
    source = replace_once(source, "${b('editPublished:'+k,'公開授業の日時・担当変更','secondary')}",
                          "${attendanceButtons(k)}${b('editPublished:'+k,'公開授業の日時・担当変更','secondary')}")
    source = replace_once(source, 'demand.filter(x=>!x.disabled&&(x.remaining>0||x.id===key))',
                          'demand.filter(x=>!x.disabled&&(x.remaining>0||x.id===key)&&(!bookingCorrectionSlot(key)||(x.date===bookingCorrectionSlot(key).slot.date&&lessonEnded(x.date,x.end))))')
    source = replace_once(source, " if(a.startsWith('cancelConfirmed:')){", """ if(a.startsWith('setAttendance:')){
   const [,status,key]=a.split(':');
   if(!bookingCorrectionSlot(key))return;
   const correction=await bookingCorrectionPayload(key);
   if(!correction)return;
   return guarded('公開授業の出欠訂正',async()=>{
     await api('setPublishedAttendance',{studentId,slotId:key,status,...correction});
     await reloadCourse();
   });
 }
 if(a.startsWith('cancelConfirmed:')){""")
    source = replace_once(source, "()=>guarded('授業取消',async()=>{\n     await api('cancelConfirmed',{studentId,slotId:key});\n     await reloadCourse();\n   }));", """async()=>{
     const correction=await bookingCorrectionPayload(key);
     if(!correction)return;
     return guarded('授業取消',async()=>{
       await api('cancelConfirmed',{studentId,slotId:key,...correction});
       await reloadCourse();
     });
   });""")
    return IMPORT + replace_once(source, "()=>guarded('公開授業変更',async()=>{\n     await api(published?'changePublished':'moveUnpublished',{studentId,from,to,teacherUid,subject});\n     editorMode='';await reloadCourse();\n   }));", """async()=>{
     const correction=published?await bookingCorrectionPayload(from):{};
     if(!correction)return;
     return guarded('公開授業変更',async()=>{
       await api(published?'changePublished':'moveUnpublished',{studentId,from,to,teacherUid,subject,...correction});
       editorMode='';await reloadCourse();
     });
   });""")


def prepare(root):
    assets = {name: (root / name).read_text(encoding='utf-8') for name in SOURCE_NAMES}
    for html in ('index.html', 'course-booking-admin.html'):
        if 'data-shiftly-environment="qa"' not in assets[html]:
            raise ValueError('QA CORRECTION UI TARGET MISMATCH')
    for script in ('app.js', 'course-booking-admin.js'):
        binding = re.search(r"'\./(config-qa-[\w.-]+\.js)'", assets[script])
        if not binding:
            raise ValueError('QA CORRECTION UI CONFIG MODULE MISSING')
        config = (root / binding.group(1)).read_text(encoding='utf-8')
        if not re.search(r"\bprojectId['\"]?\s*:\s*['\"]shiftly-t-test['\"]", config) or 'shiftly-qa-v1' not in config:
            raise ValueError('QA CORRECTION UI TARGET MISMATCH')
    assets.pop('index.html')
    if not assets['seasonal-authority-client.js'].startswith(IMPORT):
        assets['seasonal-authority-client.js'] = update_seasonal_client(assets['seasonal-authority-client.js'])
        for old, new in [
            ('await commands.publishCourse({courseId:course.id,beforeCourse:course,changes:[{id,before:old||null,value:data}]});',
             'if((await commands.publishCourse({courseId:course.id,beforeCourse:course,changes:[{id,before:old||null,value:data}]})).cancelled)return;'),
            ('await commands.publishCourse({courseId:old.courseId,beforeCourse:state.courses.find(c=>c.id===old.courseId),changes:[{id:old.id,before:old,remove:true}]});',
             'if((await commands.publishCourse({courseId:old.courseId,beforeCourse:state.courses.find(c=>c.id===old.courseId),changes:[{id:old.id,before:old,remove:true}]})).cancelled)return;'),
            ('await commands.publishCourse({\n        courseId:course.id,', 'const result=await commands.publishCourse({\n        courseId:course.id,'),
            ('\n      if(await refreshPublishedCourseEditor(course,editor,current)){', '\n      if(result.cancelled)return;\n      if(await refreshPublishedCourseEditor(course,editor,current)){'),
        ]:
            assets['app.js'] = replace_once(assets['app.js'], old, new)
    if not assets['course-booking-admin.js'].startswith(IMPORT):
        assets['course-booking-admin.js'] = update_booking(assets['course-booking-admin.js'])
    assets['app.js'] = version(assets['app.js'], 'seasonal-authority-client.js')
    assets['course-booking-admin.html'] = version(assets['course-booking-admin.html'], 'course-booking-admin.js')
    assets['ranking-correction-ui.js'] = Path(__file__).with_name('ranking-correction-ui.js').read_text(encoding='utf-8')
    return assets


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', type=Path, help='QA Hosting staging directory')
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    try:
        assets = prepare(args.root)
        if not args.check:
            for name, contents in assets.items():
                (args.root / name).write_text(contents, encoding='utf-8')
    except (OSError, ValueError) as error:
        parser.exit(1, f'{error}\n')
    print('SUCCESS RANKING CORRECTION UI ' + ('QA SOURCE CHECK' if args.check else 'PATCH APPLIED'))


if __name__ == '__main__':
    main()
