import { WorkCommandCenter } from "@/components/work-commands/command-center";

export default function WorkCommandsPage() {
  return (
    <div dir="rtl" className="space-y-3">
      <div>
        <h1 className="text-2xl font-extrabold text-foreground">مركز أوامر العمل</h1>
        <p className="mt-1 text-sm text-muted-foreground">محادثات الأقسام وأوامر العمل في مكان واحد. كل أمر يُحفظ كمهمة في سجل المهام.</p>
      </div>
      <WorkCommandCenter mode="admin" />
    </div>
  );
}
