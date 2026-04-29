import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth/session";
import { requireRole } from "@/lib/rbac/guards";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

type CreateTenantPayload = {
  action?: "create-tenant" | "restore-suspension" | "new-override";
  name?: string;
  plan?: string;
  adminUsername?: string;
  adminPassword?: string;
  suspensionId?: number;
  tenantId?: string;
  targetLabel?: string;
  reason?: string;
  expiresAt?: string;
};

const allowedPlans = new Set(["free", "pro", "enterprise"]);

const getActorLabel = async (supabase: any, userId: string) => {
  const { data } = await supabase
    .from("app_users")
    .select("email, full_name")
    .eq("id", userId)
    .single();

  return data?.full_name || data?.email || "superadmin";
};

const toCount = (value: number | null | undefined) => value ?? 0;

const normalizeUsername = (value: string) => value.trim().toLowerCase();

const usernameToEmail = (value: string) => {
  const cleaned = normalizeUsername(value);
  return cleaned.includes("@") ? cleaned : `${cleaned}@wedding.com`;
};

async function findAuthUserByEmail(admin: any, email: string) {
  const { data, error } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });

  if (error) {
    throw error;
  }

  return data.users.find((user: any) => user.email === email) ?? null;
}

async function provisionTenantAdmin(
  admin: any,
  tenant: { id: string; name: string },
  adminUsername: string,
  adminPassword: string
) {
  const username = normalizeUsername(adminUsername);
  const password = adminPassword.trim();

  if (!username) {
    throw new Error("Admin username is required.");
  }

  if (password.length < 8) {
    throw new Error("Admin password must be at least 8 characters.");
  }

  const adminEmail = usernameToEmail(username);
  const existingAuthUser = await findAuthUserByEmail(admin, adminEmail);

  let authUserId: string;

  if (existingAuthUser) {
    const { error } = await admin.auth.admin.updateUserById(existingAuthUser.id, {
      password,
      email_confirm: true,
      user_metadata: {
        full_name: `Admin ${tenant.name}`,
      },
    });

    if (error) {
      throw error;
    }

    authUserId = existingAuthUser.id;
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email: adminEmail,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: `Admin ${tenant.name}`,
      },
    });

    if (error) {
      throw error;
    }

    if (!data.user) {
      throw new Error(`Failed to create auth user for ${adminEmail}`);
    }

    authUserId = data.user.id;
  }

  const { error: appUserError } = await admin
    .from("app_users")
    .upsert(
      {
        id: authUserId,
        email: adminEmail,
        full_name: `Admin ${tenant.name}`,
        default_tenant_id: tenant.id,
        is_superadmin: false,
      },
      { onConflict: "id" }
    );

  if (appUserError) {
    throw appUserError;
  }

  const { error: membershipError } = await admin.from("tenant_memberships").upsert(
    {
      tenant_id: tenant.id,
      user_id: authUserId,
      role: "admin",
    },
    { onConflict: "tenant_id,user_id" }
  );

  if (membershipError) {
    throw membershipError;
  }

  return { authUserId, adminEmail };
}

async function loadOverview(supabase: any) {
  try {
    const queries = [
      supabase.from("tenants").select("id", { count: "exact", head: true }),
      supabase.from("app_users").select("id", { count: "exact", head: true }),
      supabase.from("contacts").select("id", { count: "exact", head: true }),
      supabase
        .from("tenant_suspensions")
        .select("id", { count: "exact", head: true })
        .eq("status", "suspended"),
      supabase
        .from("permission_overrides")
        .select("id", { count: "exact", head: true })
        .eq("active", true),
      supabase
        .from("tenants")
        .select("id, name, plan, created_at")
        .order("created_at", { ascending: false })
        .limit(6),
      supabase.from("tenants").select("plan"),
      supabase
        .from("tenant_suspensions")
        .select("id, tenant_name, target_type, target_label, reason, status, suspended_at, restored_at, restored_by_label")
        .order("suspended_at", { ascending: false })
        .limit(10),
      supabase
        .from("permission_overrides")
        .select("id, tenant_name, target_label, reason, expires_at, granted_by_label, active, granted_at, revoked_at")
        .order("granted_at", { ascending: false })
        .limit(10),
      supabase
        .from("superadmin_audit_logs")
        .select("id, tenant_name, actor_label, action, details, created_at")
        .order("created_at", { ascending: false })
        .limit(10),
    ];

    const results = await Promise.all(queries);
    
    const [
      tenantsCount,
      usersCount,
      contactsCount,
      suspendedCount,
      overridesCount,
      recentTenants,
      allPlans,
      suspensions,
      overrides,
      auditLogs,
    ] = results;

    const planCounts = ((allPlans.data ?? []) as { plan: string }[]).reduce<Record<string, number>>((accumulator, row) => {
      if (row && row.plan) {
        accumulator[row.plan] = (accumulator[row.plan] ?? 0) + 1;
      }
      return accumulator;
    }, {});

    return {
      summary: {
        totalTenants: toCount(tenantsCount.count),
        activeUsers: toCount(usersCount.count),
        contacts: toCount(contactsCount.count),
        suspendedTenants: toCount(suspendedCount.count),
        activeOverrides: toCount(overridesCount.count),
      },
      planCounts,
      recentTenants: recentTenants.data ?? [],
      suspensions: suspensions.data ?? [],
      overrides: overrides.data ?? [],
      auditLogs: auditLogs.data ?? [],
    };
  } catch (err: any) {
    console.error("[loadOverview] Error:", err);
    throw new Error(`Failed to load overview: ${err.message}`);
  }
}

export async function GET(request: Request) {
  try {
    const context = await getSessionContext(request, {
      allowSuperadminTenantFromRequest: true,
    });

    requireRole(context, ["superadmin"]);

    const overview = await loadOverview(context.supabase);
    return NextResponse.json(overview);
  } catch (error: any) {
    console.error("[GET /api/superadmin] Error:", error);
    const message = error?.message || "Internal Server Error";
    const status = (message === "Forbidden" || message === "Unauthorized") 
      ? (message === "Forbidden" ? 403 : 401) 
      : 500;
    
    return NextResponse.json({ 
      error: message,
      details: error instanceof Error ? error.stack : String(error)
    }, { status });
  }
}

export async function POST(request: Request) {
  try {
    const context = await getSessionContext(request, {
      allowSuperadminTenantFromRequest: true,
    });

    requireRole(context, ["superadmin"]);

    const payload = (await request.json()) as CreateTenantPayload;
    const action = payload.action;
    const actorLabel = await getActorLabel(context.supabase, context.userId);

    if (action === "create-tenant") {
      const tenantName = (payload.name ?? "").trim();
      if (!tenantName) {
        return NextResponse.json({ error: "Tenant name is required." }, { status: 400 });
      }

      const adminUsername = (payload.adminUsername ?? "").trim();
      const adminPassword = (payload.adminPassword ?? "").trim();

      if (!adminUsername || !adminPassword) {
        return NextResponse.json(
          { error: "Admin username and admin password are required." },
          { status: 400 }
        );
      }

      const tenantPlan = allowedPlans.has((payload.plan ?? "free").toLowerCase())
        ? (payload.plan ?? "free").toLowerCase()
        : "free";

      const { data: tenant, error: tenantError } = await context.supabase
        .from("tenants")
        .insert({ name: tenantName, plan: tenantPlan })
        .select("id, name, plan, created_at")
        .single();

      if (tenantError) {
        throw tenantError;
      }

      const adminClient = getSupabaseAdmin();
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
      console.log(`[POST /api/superadmin] Using service key starting with: ${serviceKey.substring(0, 10)}...`);
      
      const { adminEmail } = await provisionTenantAdmin(adminClient, tenant, adminUsername, adminPassword);

      await context.supabase.from("superadmin_audit_logs").insert({
        tenant_id: tenant.id,
        tenant_name: tenant.name,
        actor_label: actorLabel,
        action: "create_tenant",
        details: `plan=${tenant.plan}; admin=${adminEmail}`,
      });

      return NextResponse.json({ tenant, assignedAdmin: adminEmail });
    }

    if (action === "restore-suspension") {
      if (!payload.suspensionId) {
        return NextResponse.json({ error: "Suspension ID is required." }, { status: 400 });
      }

      const { data: suspension, error: suspensionError } = await context.supabase
        .from("tenant_suspensions")
        .update({
          status: "restored",
          restored_by_label: actorLabel,
          restored_at: new Date().toISOString(),
        })
        .eq("id", payload.suspensionId)
        .select("id, tenant_name, target_label")
        .single();

      if (suspensionError) {
        throw suspensionError;
      }

      await context.supabase.from("superadmin_audit_logs").insert({
        tenant_id: null,
        tenant_name: suspension?.tenant_name ?? null,
        actor_label: actorLabel,
        action: "restore_suspension",
        details: `restored=${suspension?.target_label ?? payload.suspensionId}`,
      });

      return NextResponse.json({ suspension });
    }

    if (action === "new-override") {
      const tenantId = payload.tenantId?.trim();
      const targetLabel = payload.targetLabel?.trim();
      const reason = payload.reason?.trim();
      const expiresAt = payload.expiresAt?.trim();

      if (!tenantId || !targetLabel || !reason || !expiresAt) {
        return NextResponse.json(
          { error: "tenantId, targetLabel, reason, and expiresAt are required." },
          { status: 400 }
        );
      }

      const { data: tenant } = await context.supabase
        .from("tenants")
        .select("id, name")
        .eq("id", tenantId)
        .single();

      const { data: override, error: overrideError } = await context.supabase
        .from("permission_overrides")
        .insert({
          tenant_id: tenantId,
          tenant_name: tenant?.name ?? tenantId,
          target_label: targetLabel,
          reason,
          expires_at: expiresAt,
          granted_by_label: actorLabel,
          active: true,
        })
        .select("id, tenant_name, target_label, reason, expires_at, granted_by_label, active, granted_at")
        .single();

      if (overrideError) {
        throw overrideError;
      }

      await context.supabase.from("superadmin_audit_logs").insert({
        tenant_id: tenantId,
        tenant_name: tenant?.name ?? tenantId,
        actor_label: actorLabel,
        action: "new_override",
        details: `${targetLabel} until ${expiresAt}`,
      });

      return NextResponse.json({ override });
    }

    return NextResponse.json({ error: "Unsupported action." }, { status: 400 });
  } catch (error: any) {
    console.error("[POST /api/superadmin] Error:", error);
    const message = error?.message || "Forbidden";
    const status = message === "Tenant required" ? 400 : message === "Forbidden" ? 403 : 500;
    return NextResponse.json({ 
      error: message,
      details: error instanceof Error ? error.stack : String(error)
    }, { status });
  }
}