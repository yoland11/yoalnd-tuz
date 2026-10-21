import {useState} from "react";
import {useQueryClient} from "@tanstack/react-query";
import {BookingLoadingPanel} from "./booking-loading-panel";
import {QuantityBookingAssetDialog,type QuantityBookingTarget} from "@/views/admin/quantity-booking-asset-dialog";

/** The staff portal reuses the original authorized asset return route and dialog. */
export function StaffBookingLoading({id,source,onReturned}:{id:number;source:"kosha"|"service";onReturned:()=>void}){
  const client=useQueryClient();
  const queryKey=["staff","koshas","booking-loading",source,id];
  const [target,setTarget]=useState<QuantityBookingTarget|null>(null);
  return <>
    <BookingLoadingPanel endpoint={`/staff/koshas/loading/${id}?source=${source}`} queryKey={queryKey} onReturn={(line,outstanding)=>{
      const custody=/^custody:(\d+)$/.exec(line.origin);
      setTarget({productId:line.productId,custodyId:custody?Number(custody[1]):null,trackingMode:line.tracking,name:line.name,unit:line.unit,quantity:line.required,outstanding});
    }}/>
    <QuantityBookingAssetDialog endpoint={`/staff/koshas/bookings/${id}/assets?source=${source}`} target={target} initialMode="return" allowedModes={["return"]} onClose={()=>setTarget(null)} onDone={()=>{void client.invalidateQueries({queryKey});onReturned()}}/>
  </>;
}
