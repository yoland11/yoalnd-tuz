export type AdminBootstrapDecision =
  | "create"
  | "disabled"
  | "administrator_exists"
  | "username_exists"
  | "password_missing";

export function decideAdminBootstrap(input: {
  enabled: boolean;
  administratorExists: boolean;
  usernameExists: boolean;
  passwordPresent: boolean;
}): AdminBootstrapDecision {
  if (!input.enabled) return "disabled";
  if (input.administratorExists) return "administrator_exists";
  if (input.usernameExists) return "username_exists";
  if (!input.passwordPresent) return "password_missing";
  return "create";
}
