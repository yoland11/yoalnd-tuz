import type { Customer } from "./customer";

export interface AuthResult {
  customer: Customer;
  token: string;
}
