import { getSupabaseAdmin } from "./lib/supabase-admin.js";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function test() {
  try {
    const supabase = getSupabaseAdmin();
    console.log("Checking tables...");
    
    const tables = [
      "tenants",
      "app_users",
      "contacts",
      "tenant_suspensions",
      "permission_overrides",
      "superadmin_audit_logs"
    ];

    for (const table of tables) {
      const { count, error } = await supabase.from(table).select("*", { count: "exact", head: true });
      if (error) {
        console.error(`Error on table ${table}:`, error.message);
      } else {
        console.log(`Table ${table} exists, count: ${count}`);
      }
    }
  } catch (err) {
    console.error("Test failed:", err);
  }
}

test();
