function activitySessionId() {
  if (typeof window === "undefined") return "anonymous";
  const key = "ajn_customer_activity_session";
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const next = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  window.localStorage.setItem(key, next);
  return next;
}

export function logCustomerActivity(input: {
  action: string;
  entityType?: string;
  entityId?: number;
  entityLabel?: string;
  phone?: string;
  metadata?: Record<string, unknown>;
}) {
  if (typeof window === "undefined") return;
  const payload = {
    sessionId: activitySessionId(),
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    entityLabel: input.entityLabel,
    phone: input.phone,
    metadata: input.metadata ?? {},
  };
  window.setTimeout(() => {
    fetch("/api/activity", {
      method: "POST",
      headers: { "content-type": "application/json", "x-session-id": payload.sessionId },
      body: JSON.stringify(payload),
      credentials: "include",
      keepalive: true,
    }).catch(() => undefined);
  }, 0);
}
