import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing Supabase credentials in .env.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function listTenants() {
  console.log("Listing all tenants...");
  const { data, error } = await supabase
    .from("tenants")
    .select("id, name, created_at");

  if (error) {
    console.error("Error fetching tenants:", error.message);
    return;
  }

  if (!data || data.length === 0) {
    console.log("No tenants found.");
  } else {
    console.table(data);
  }
}

listTenants();
