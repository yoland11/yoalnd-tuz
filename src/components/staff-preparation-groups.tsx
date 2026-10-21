import {ClipboardList,FileText,Play} from 'lucide-react';
import {staffPreparationGroups,type StaffPreparationTask} from '@/lib/staff-preparation-groups';
import {Accordion,AccordionContent,AccordionItem,AccordionTrigger} from './ui/accordion';
import {Badge} from './ui/badge';
import {Button} from './ui/button';
import {Progress} from './ui/progress';

export function StaffPreparationGroups<T extends StaffPreparationTask>({tasks,actorId,busy,onOpen,onProgress,departmentLabel,statusLabel}:{
  tasks:readonly T[];actorId:number;busy:boolean;onOpen:(id:number)=>void;onProgress:(task:T,action:'accept'|'start')=>void;
  departmentLabel:(key:string)=>string;statusLabel:(status:string)=>string;
}){
  const groups=staffPreparationGroups(tasks,actorId);
  if(!groups.length)return null;
  return <section aria-label="مجموعات تجهيزي" dir="rtl" className="rounded-xl border border-border bg-card p-4 sm:p-5">
    <div className="flex items-center gap-2"><ClipboardList className="size-5 text-primary" aria-hidden="true"/><h2 className="text-base font-bold">مجموعات تجهيزي</h2><Badge variant="outline">{groups.length} مجموعات</Badge></div>
    <p className="mt-2 max-w-prose text-sm leading-6 text-muted-foreground">تجميع مهامك المعروضة فقط حسب الحجز والقسم؛ قد توجد مهام أخرى خارج القائمة الحالية. النسبة لاعتماد مهامك، وليست جاهزية الحجز أو المخزون.</p>
    <Accordion type="multiple" className="mt-2">
      {groups.map(group=><AccordionItem key={group.key} value={group.key}>
        <AccordionTrigger className="gap-3 text-start"><span className="flex min-w-0 flex-1 flex-col gap-1"><span className="break-words font-semibold">{group.customerName||'حجز بدون اسم عميل'}</span><span className="text-xs text-muted-foreground">{group.source==='kosha'?'حجز كوشة':'حجز خدمة'} · {departmentLabel(group.department)}</span></span><Badge variant="outline">{group.approved} من {group.tasks.length} معتمدة</Badge></AccordionTrigger>
        <AccordionContent>
          <div className="mb-3 flex flex-col gap-2"><div className="flex flex-wrap gap-2"><Badge variant="secondary">{group.review} بانتظار الاعتماد</Badge><Badge variant="outline">{group.active} قيد العمل</Badge></div><Progress value={group.percentage} aria-valuenow={group.percentage} aria-label="اعتماد مهام التجهيز المعروضة" aria-valuetext={`${group.approved} من ${group.tasks.length} مهام معتمدة`}/></div>
          <ul className="flex flex-col divide-y divide-border">{group.tasks.map(task=><li key={task.id} className="flex min-w-0 flex-col gap-3 py-3 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><h3 className="break-words font-semibold">{task.title}</h3><p className="mt-1 text-sm text-muted-foreground">{statusLabel(task.status)}</p></div><div className="flex flex-wrap gap-2">{task.status==='new'?<Button disabled={busy} className="min-h-11" variant="outline" onClick={()=>onProgress(task,'accept')}>استلام المهمة</Button>:task.status==='accepted'?<Button disabled={busy} className="min-h-11" onClick={()=>onProgress(task,'start')}><Play data-icon="inline-start"/>بدء التجهيز</Button>:null}<Button variant="outline" className="min-h-11" onClick={()=>onOpen(task.id)} aria-label={`فتح مهمة ${task.title}`}><FileText data-icon="inline-start"/>تفاصيل المهمة</Button></div></li>)}</ul>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">التسليم والصور والملاحظات من تفاصيل المهمة الأصلية. اعتماد الإدارة لا يتم من هذا التجميع.</p>
        </AccordionContent>
      </AccordionItem>)}
    </Accordion>
  </section>;
}
