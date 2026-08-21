import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * Keeps long booking edits safe on desktop and mobile. In-app close attempts
 * use the AJN dialog; browser/tab navigation uses the platform beforeunload
 * prompt because browsers do not allow a custom modal at that point.
 */
export function useEditFormGuard(dirty: boolean, onClose: () => void) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const requestClose = () => {
    if (dirty) setConfirmOpen(true);
    else onClose();
  };

  const guardDialog = (
    <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
      <AlertDialogContent dir="rtl">
        <AlertDialogHeader>
          <AlertDialogTitle>لديك تعديلات غير محفوظة</AlertDialogTitle>
          <AlertDialogDescription>
            إذا غادرت الآن ستفقد التغييرات التي أجريتها على الحجز.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>متابعة التعديل</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={onClose}
          >
            تجاهل التعديلات
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { requestClose, guardDialog };
}
