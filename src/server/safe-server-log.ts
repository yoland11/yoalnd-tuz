export function safeServerError(error: unknown) {
  const value = error as { name?: unknown; code?: unknown; message?: unknown; cause?: { name?: unknown; code?: unknown; message?: unknown } } | null;
  const cause = value?.cause;
  const source = cause?.message ? cause : value;
  const rawMessage = String(source?.message ?? "server operation failed")
    .split(/\nparams?:/i, 1)[0]
    .replace(/(postgres(?:ql)?:\/\/)[^@\s]+@/gi, "$1[REDACTED]@")
    .replace(/(bearer\s+)[A-Za-z0-9._~-]+/gi, "$1[REDACTED]")
    .replace(/(password|token|authorization|api[_-]?key|secret)(["'=:\s]+)[^\s&,}\]]+/gi, "$1$2[REDACTED]")
    .slice(0, 300);
  return {
    name: String(source?.name ?? value?.name ?? "Error").slice(0, 80),
    code: String(cause?.code ?? value?.code ?? "UNKNOWN").replace(/[^A-Z0-9_-]/gi, "").slice(0, 32),
    message: rawMessage,
  };
}
