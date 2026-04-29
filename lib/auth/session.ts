import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Role } from "@/lib/rbac/types";

export type SessionContext = {
  userId: string;
  tenantId?: string;
  role: Role;
  isSuperadmin: boolean;
  supabase: SupabaseClient;
};

type SessionOptions = {
  allowSuperadminTenantFromRequest?: boolean;
  requireTenant?: boolean;
};

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const getBearerToken = (request: Request) => {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }

  return authHeader.split(" ")[1];
};

const getTenantFromRequest = (request: Request) => {
  const headerTenant = request.headers.get("x-tenant-id");
  if (headerTenant) return headerTenant;

  const url = new URL(request.url);
  return url.searchParams.get("tenant_id") ?? undefined;
};

export async function getSessionContext(
  request: Request,
  options: SessionOptions = {}
): Promise<SessionContext> {
  const token = getBearerToken(request);
  if (!token) {
    throw new Error("Unauthorized");
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    throw new Error("Unauthorized");
  }

  const { data: appUser, error: appUserError } = await supabase
    .from("app_users")
    .select("is_superadmin, default_tenant_id")
    .eq("id", user.id)
    .single();

  if (appUserError || !appUser) {
    throw new Error("Unauthorized");
  }

  const isSuperadmin = Boolean(appUser.is_superadmin);
  let tenantId = appUser.default_tenant_id ?? undefined;

  if (isSuperadmin && options.allowSuperadminTenantFromRequest !== false) {
    const requestedTenant = getTenantFromRequest(request);
    if (requestedTenant) {
      tenantId = requestedTenant;
    }
  }

  let role: Role = isSuperadmin ? "superadmin" : "user";

  if (!isSuperadmin) {
    if (!tenantId && options.requireTenant) {
      throw new Error("Tenant required");
    }

    if (tenantId) {
      const { data: membership, error: membershipError } = await supabase
        .from("tenant_memberships")
        .select("role")
        .eq("tenant_id", tenantId)
        .eq("user_id", user.id)
        .single();

      if (membershipError || !membership) {
        throw new Error("Forbidden");
      }

      role = membership.role === "admin" ? "admin" : "user";
    }
  }

  return {
    userId: user.id,
    tenantId,
    role,
    isSuperadmin,
    supabase,
  };
}
