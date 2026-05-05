import { createClient } from "@supabase/supabase-js";
const supabaseUrl = "https://lguqxvowpecbdercxsye.supabase.co";
const serviceRoleKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxndXF4dm93cGVjYmRlcmN4c3llIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzI4MDAwNSwiZXhwIjoyMDkyODU2MDA1fQ.p28lvyUeoyxgGcYZm0WD2aIUmyAMTBcCDXcxY3ZnQT4";

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function findTenant() {
  console.log("Searching for 'Fizah-Hanif'...");
  
  // Try searching in tenants table
  const { data: tenants, error: tenantError } = await supabase
    .from("tenants")
    .select("*")
    .ilike("name", "%Fizah-Hanif%");

  if (tenantError) {
    console.error("Error fetching tenants:", tenantError.message);
  } else if (tenants && tenants.length > 0) {
    console.log("Found in tenants table:");
    console.table(tenants);
  } else {
    console.log("Not found in tenants table.");
  }

  // Try searching in auth.users or a profiles table if it exists
  // Since I don't know the exact profile table name, I'll search common ones
  console.log("\nSearching for users with email containing 'fizah' or 'hanif'...");
  const { data: users, error: userError } = await supabase.auth.admin.listUsers();
  
  if (userError) {
    console.error("Error fetching users:", userError.message);
  } else {
    const matchedUsers = users.users.filter(u => 
      u.email?.toLowerCase().includes("fizah") || 
      u.email?.toLowerCase().includes("hanif")
    );
    if (matchedUsers.length > 0) {
      console.log("Found matching users:");
      matchedUsers.forEach(u => {
        console.log(`ID: ${u.id}, Email: ${u.email}, Created: ${u.created_at}`);
      });
    } else {
      console.log("No matching users found.");
    }
  }
}

findTenant();
