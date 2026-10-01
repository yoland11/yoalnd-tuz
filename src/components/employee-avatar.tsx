"use client";

import { useState } from "react";
import { employeeInitials } from "@/lib/employee-identity";
import { cn } from "@/lib/utils";

export type EmployeeAvatarProps = {
  name?: string | null;
  photoUrl?: string | null;
  size?: 32 | 40 | 64 | 96 | 120;
  className?: string;
};

export function EmployeeAvatar({ name, photoUrl, size = 40, className }: EmployeeAvatarProps) {
  const url = photoUrl?.trim() || null;
  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-primary/15 bg-primary/10 font-semibold leading-none text-primary", className)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.35) }}
    >
      <AvatarContent key={url ?? "fallback"} name={name} photoUrl={url} size={size} />
    </span>
  );
}

function AvatarContent({ name, photoUrl, size }: Omit<EmployeeAvatarProps, "className">) {
  const [failed, setFailed] = useState(false);
  if (!photoUrl || failed) return <span role="img" aria-label={name?.trim() || "موظف"}>{employeeInitials(name)}</span>;
  return <img src={photoUrl} alt={name?.trim() || "صورة الموظف"} width={size} height={size} loading="lazy" decoding="async" className="h-full w-full object-cover" onError={() => setFailed(true)} />;
}
