type Item={key:string;department:string;status:string;preparationState?:string|null;stockIssued?:boolean;shortfall:number;infoOnly?:boolean;assigneeName?:string|null};
export function preparationItemNeedsAttention(item:Item){return !item.stockIssued&&item.shortfall>0||['damaged','lost','shortage','needs_purchase','reserved_elsewhere','unavailable'].includes(item.status)}
/** Availability is not preparation evidence. Legacy summaries without an
 * explicit preparation state therefore never become 100% prepared by default. */
export function preparationGroups<T extends Item>(items:T[]){
  const groups=new Map<string,T[]>();
  for(const item of items){const key=item.department||'other';if(!groups.has(key))groups.set(key,[]);groups.get(key)!.push(item);}
  return [...groups].map(([department,rows])=>{
    const required=rows.filter(item=>!item.infoOnly);
    const missing=required.filter(preparationItemNeedsAttention).length;
    const prepared=required.filter(item=>['ready','completed'].includes(item.preparationState??'')&&!preparationItemNeedsAttention(item)).length;
    return {department,items:rows,total:required.length,prepared,missing,percentage:required.length?Math.round(prepared/required.length*100):null,responsible:[...new Set(required.map(item=>item.assigneeName?.trim()).filter((name):name is string=>!!name))]};
  });
}
