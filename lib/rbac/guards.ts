import type { Role } from "@/lib/rbac/types";
import type { SessionContext } from "@/lib/auth/session";

export function requireRole(context: SessionContext, allowed: Role[]) {
  if (!allowed.includes(context.role)) {
    throw new Error("Forbidden");
  }
}

export function requireTenant(
  context: SessionContext
): asserts context is SessionContext & { tenantId: string } {
  if (!context.tenantId) {
    throw new Error("Tenant required");
  }
}
