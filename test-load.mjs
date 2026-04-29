import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

const toCount = (value) => value ?? 0;

async function loadOverview(supabase) {
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

  const planCounts = ((allPlans.data ?? [])).reduce((accumulator, row) => {
    accumulator[row.plan] = (accumulator[row.plan] ?? 0) + 1;
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
}

async function test() {
  try {
    const data = await loadOverview(supabase);
    console.log("Success:", JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Crash:", err);
  }
}

test();
