import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function test() {
  const tables = [
    "tenants",
    "app_users",
    "contacts",
    "tenant_suspensions",
    "permission_overrides",
    "superadmin_audit_logs"
  ];

  for (const table of tables) {
    const res = await supabase.from(table).select("*", { count: "exact", head: true });
    if (res.error) {
      console.log(`Table ${table}: ERROR - ${res.error.message} (${res.error.code})`);
    } else {
      console.log(`Table ${table}: OK - count ${res.count}`);
    }
  }
}

test();
