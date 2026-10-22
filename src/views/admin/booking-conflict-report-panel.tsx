import {useQuery} from "@tanstack/react-query";
import {BookingConflictReportView} from "@/components/booking-conflict-report";
import type {BookingConflictReport} from "@/lib/booking-conflict-report";
import {adminFetch} from "./_lib";

export function BookingConflictReportPanel({base,queryKey}:{base:string;queryKey:unknown[]}){
  const query=useQuery<BookingConflictReport>({queryKey:[...queryKey,"conflicts",base],queryFn:()=>adminFetch(`${base}/conflicts`),retry:false,staleTime:0});
  return <BookingConflictReportView key={base} data={query.data} loading={query.isFetching} error={query.error} onRefresh={()=>void query.refetch()}/>;
}
