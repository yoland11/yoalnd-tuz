"use client";

import { useId, useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { EmployeeAvatar } from "@/components/employee-avatar";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { employeeDisplayName, employeeMatchesQuery, employeeSecondaryLabel, type EmployeeIdentity } from "@/lib/employee-identity";
import { cn } from "@/lib/utils";

export type EmployeeSelectProps = {
  employees: EmployeeIdentity[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  emptyLabel?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  "aria-label"?: string;
};

export function EmployeeSelect({ employees, value, onValueChange, placeholder = "اختر الموظف", emptyLabel, disabled, className, id, "aria-label": ariaLabel }: EmployeeSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const listId = useId();
  const selected = employees.find((employee) => String(employee.id) === value);
  const matches = useMemo(() => employees.filter((employee) => employeeMatchesQuery(employee, search)), [employees, search]);
  const select = (nextValue: string) => {
    onValueChange(nextValue);
    setOpen(false);
    setSearch("");
  };
  return (
    <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) setSearch(""); }}>
      <PopoverTrigger asChild>
        <Button id={id} type="button" variant="outline" role="combobox" aria-expanded={open} aria-controls={open ? listId : undefined} aria-label={ariaLabel || placeholder} disabled={disabled} className={cn("h-auto min-h-11 w-full justify-between gap-2 px-3 py-1.5 text-start font-normal", className)}>
          {selected ? <EmployeeOption employee={selected} /> : <span className="truncate text-muted-foreground">{value ? "الموظف المحدد غير متاح" : emptyLabel || placeholder}</span>}
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] min-w-56 max-w-[calc(100vw-2rem)] p-0" dir="rtl">
        <Command shouldFilter={false}>
          <CommandInput value={search} onValueChange={setSearch} placeholder="ابحث بالاسم أو القسم أو الوظيفة..." aria-label="البحث عن موظف" />
          <CommandList id={listId}>
            <CommandEmpty>لا يوجد موظفون مطابقون للبحث.</CommandEmpty>
            <CommandGroup>
              {emptyLabel && !search.trim() ? <CommandItem value="clear-employee-selection" onSelect={() => select("")}><span className="flex-1">{emptyLabel}</span>{!value ? <Check aria-hidden="true" /> : null}</CommandItem> : null}
              {matches.map((employee) => <CommandItem key={employee.id} value={String(employee.id)} onSelect={() => select(String(employee.id))} className="gap-3 py-2"><EmployeeOption employee={employee} />{value === String(employee.id) ? <Check className="ms-auto text-primary" aria-hidden="true" /> : null}</CommandItem>)}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function EmployeeOption({ employee }: { employee: EmployeeIdentity }) {
  const name = employeeDisplayName(employee);
  const secondary = employeeSecondaryLabel(employee);
  return <span className="flex min-w-0 items-center gap-2"><span aria-hidden="true"><EmployeeAvatar name={name} photoUrl={employee.photoUrl} size={32} /></span><span className="min-w-0"><span className="block truncate text-sm">{name}</span>{secondary ? <span className="block truncate text-xs text-muted-foreground">{secondary}</span> : null}</span></span>;
}
