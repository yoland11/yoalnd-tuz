import {CheckCheck,ClipboardCheck,Filter,Play} from 'lucide-react';
import {Button} from './ui/button';
import {Badge} from './ui/badge';
import {Progress} from './ui/progress';
type Group={department:string;total:number;prepared:number;missing:number;percentage:number|null;responsible:string[]};
export function PreparationGroupSummary({group,label,busy,canManage,onlyMissing,onSelect,onAction,onToggleMissing}:{group:Group;label:string;busy:boolean;canManage:boolean;onlyMissing:boolean;onSelect:()=>void;onAction:(action:'start'|'confirm')=>void;onToggleMissing:()=>void}){
  return <header className="flex flex-col gap-3 py-3" aria-label={`ملخص مجموعة ${label}`}>
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{label}</h3><Badge variant={group.missing?'destructive':'outline'}>{group.missing?`${group.missing} عناصر تحتاج متابعة`:'لا نواقص مسجلة'}</Badge></div>
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><span>تجهيز مسجّل: {group.prepared} من {group.total}</span><span className="text-muted-foreground">{group.responsible.length?`المسؤول: ${group.responsible.join('، ')}`:'لم يُعيّن مسؤول للمجموعة'}</span></div>
    <Progress value={group.percentage??0} aria-valuenow={group.percentage??undefined} aria-valuetext={`تجهيز مسجّل: ${group.prepared} من ${group.total}`} aria-label={`نسبة تجهيز ${label}`} />
    <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={busy||!group.total} onClick={onSelect}><CheckCheck data-icon="inline-start"/>تحديد المجموعة</Button><Button size="sm" variant="outline" disabled={busy||!canManage||!group.total||group.prepared===group.total} onClick={()=>onAction('start')}><Play data-icon="inline-start"/>بدء تجهيز المجموعة</Button><Button size="sm" disabled={busy||!canManage||!group.total||group.missing>0} onClick={()=>onAction('confirm')}><ClipboardCheck data-icon="inline-start"/>تأكيد تجهيز المجموعة</Button><Button size="sm" variant="outline" aria-pressed={onlyMissing} onClick={onToggleMissing}><Filter data-icon="inline-start"/>{onlyMissing?'عرض كل العناصر':'عرض النواقص'}</Button></div>
  </header>;
}
