import {useEffect,useRef} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookingResourceWindowForm, type BookingResourceWindowData } from "@/components/booking-resource-window-form";
import { adminFetch } from "./_lib";

function ResourceWindowEditor({ base, queryKey,onSaved }: { base: string; queryKey: unknown[];onSaved?:()=>void }) {
  const client = useQueryClient();
  const mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const key = ["booking-resource-window", base];
  const query = useQuery<BookingResourceWindowData>({ queryKey: key, queryFn: () => adminFetch(`${base}/resource-window`), retry: false });
  return <BookingResourceWindowForm data={query.data} loading={query.isFetching} error={query.error} onRetry={() => void query.refetch()} onSave={async (window, expectedWindow, calendar) => {
    const result = await adminFetch(`${base}/resource-window`, { method: "PUT", body: JSON.stringify({ window, expectedWindow, ...(calendar ? { calendar } : {}) }) });
    // Invalidate only the original source+ID, even if this request completes
    // after navigation. Never clear a new booking's draft through live props.
    client.setQueryData<BookingResourceWindowData>(key, old => old ? { ...old, resourceWindow: window, expectedWindow: window, ...(calendar ? { eventDate: result.eventDate, eventTime: result.eventTime } : {}) } : old);
    void client.invalidateQueries({ queryKey });
    if(mounted.current)onSaved?.();
  }} />;
}
export function BookingResourceWindowPanel(props: { base: string; queryKey: unknown[];onSaved?:()=>void }) {
  return <ResourceWindowEditor key={props.base} {...props} />;
}
