type Environment = NodeJS.ProcessEnv | Record<string, string | undefined>;

const PLACEHOLDER = /(replace[-_ ]?with|change[-_ ]?this|changeme|example\.(com|org)|your[-_ ]|password)/i;
const TEST_DATABASE = /(^|[_-])(test|testing|spec)($|[_-])/i;

function value(env: Environment, key: string) {
  return String(env[key] ?? "").trim();
}

function databaseName(connectionString: string) {
  try {
    return new URL(connectionString).pathname.replace(/^\//, "");
  } catch {
    return "";
  }
}

function databaseHost(connectionString: string) {
  try {
    return new URL(connectionString).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function isLocalHost(host: string) {
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function requireValue(
  issues: string[],
  env: Environment,
  key: string,
  options: { secret?: boolean } = {},
) {
  const current = value(env, key);
  if (!current) {
    issues.push(`${key} is required`);
    return;
  }
  if (PLACEHOLDER.test(current)) issues.push(`${key} contains a placeholder value`);
  if (options.secret && current.length < 32)
    issues.push(`${key} must contain at least 32 characters`);
}

function requireOneOf(
  issues: string[],
  env: Environment,
  keys: readonly string[],
  options: { secret?: boolean } = {},
) {
  const selected = keys.find((key) => value(env, key));
  if (!selected) {
    issues.push(`one of ${keys.join(", ")} is required`);
    return;
  }
  requireValue(issues, env, selected, options);
}

/**
 * Returns variable names and policy failures only. Values are deliberately
 * omitted so this can be logged without leaking secrets or connection strings.
 */
export function productionEnvironmentIssues(env: Environment = process.env) {
  const issues: string[] = [];
  const nodeProduction = value(env, "NODE_ENV") === "production";
  const vercelProduction = value(env, "VERCEL_ENV") === "production";
  const ajnEnvironment = value(env, "AJN_ENV");
  const testHarness =
    ajnEnvironment === "test" &&
    value(env, "ALLOW_TEST_WRITES") === "true" &&
    !value(env, "VERCEL") &&
    !vercelProduction;

  if (!nodeProduction && !vercelProduction && ajnEnvironment !== "production")
    return issues;
  if (testHarness) return issues;

  if (ajnEnvironment !== "production")
    issues.push("AJN_ENV must be production in a production runtime");

  requireValue(issues, env, "DATABASE_URL", { secret: true });
  requireOneOf(issues, env, ["AUTH_SECRET", "SESSION_SECRET", "NEXTAUTH_SECRET"], {
    secret: true,
  });
  requireValue(issues, env, "APP_BASE_URL");
  requireValue(issues, env, "CRON_SECRET", { secret: true });
  requireOneOf(issues, env, ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]);
  requireOneOf(issues, env, ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE"], {
    secret: true,
  });
  requireOneOf(issues, env, ["SUPABASE_STORAGE_BUCKET", "SUPABASE_BUCKET"]);
  requireOneOf(issues, env, [
    "AJN_RESEARCH_PRIVATE_BUCKET",
    "AJN_CUSTOMER_PRIVATE_BUCKET",
    "SUPABASE_CUSTOMER_PRIVATE_BUCKET",
  ]);
  requireValue(issues, env, "ULTRAMSG_INSTANCE_ID");
  requireValue(issues, env, "ULTRAMSG_TOKEN");

  const databaseUrl = value(env, "DATABASE_URL");
  if (databaseUrl) {
    const host = databaseHost(databaseUrl);
    const name = databaseName(databaseUrl);
    if (!host || !name) issues.push("DATABASE_URL must be a valid PostgreSQL URL");
    if (isLocalHost(host)) issues.push("DATABASE_URL must not use localhost in production");
    if (TEST_DATABASE.test(name)) issues.push("DATABASE_URL points to a test database");
    if (value(env, "TEST_DATABASE_URL") === databaseUrl)
      issues.push("DATABASE_URL must not equal TEST_DATABASE_URL in production");
  }

  if (value(env, "RATE_LIMIT_BACKEND") !== "postgres")
    issues.push("RATE_LIMIT_BACKEND must be postgres in production");

  const appUrl = value(env, "APP_BASE_URL");
  if (appUrl) {
    try {
      const parsed = new URL(appUrl);
      if (parsed.protocol !== "https:") issues.push("APP_BASE_URL must use HTTPS");
      if (isLocalHost(parsed.hostname.toLowerCase()))
        issues.push("APP_BASE_URL must not use localhost in production");
    } catch {
      issues.push("APP_BASE_URL must be a valid absolute URL");
    }
  }

  if (value(env, "ADMIN_BOOTSTRAP_ENABLED") === "true") {
    requireValue(issues, env, "ADMIN_USERNAME");
    requireValue(issues, env, "ADMIN_PASSWORD", { secret: true });
  }

  return [...new Set(issues)];
}

export class ProductionEnvironmentError extends Error {
  constructor(readonly issues: readonly string[]) {
    super("AJN production environment validation failed");
    this.name = "ProductionEnvironmentError";
  }
}

export function assertProductionEnvironment(env: Environment = process.env) {
  const issues = productionEnvironmentIssues(env);
  if (issues.length) throw new ProductionEnvironmentError(issues);
}
