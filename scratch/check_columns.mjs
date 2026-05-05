import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function checkTenants() {
  const { data, error } = await supabase
    .from("tenants")
    .select("*")
    .limit(1);

  if (error) {
    console.error(error);
    return;
  }
  console.log("Columns in tenants table:", Object.keys(data[0]));
}

checkTenants();
