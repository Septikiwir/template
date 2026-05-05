import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://lguqxvowpecbdercxsye.supabase.co";
const serviceRoleKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxndXF4dm93cGVjYmRlcmN4c3llIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzI4MDAwNSwiZXhwIjoyMDkyODU2MDA1fQ.p28lvyUeoyxgGcYZm0WD2aIUmyAMTBcCDXcxY3ZnQT4";

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function debugContacts() {
  console.log("Fetching ALL contacts...");
  
  const { data, error } = await supabase
    .from("contacts")
    .select("id, tenant_id");

  if (error) {
    console.error("Error:", error.message);
    return;
  }

  console.log(`Total contacts found in database: ${data.length}`);
  
  const groups = {};
  data.forEach(c => {
    groups[c.tenant_id] = (groups[c.tenant_id] || 0) + 1;
  });

  console.log("\nDistribution by tenant_id:");
  for (const [tid, count] of Object.entries(groups)) {
    const { data: tenant } = await supabase.from("tenants").select("name").eq("id", tid).single();
    console.log(`- ${tid} (${tenant?.name || 'N/A'}): ${count} contacts`);
  }

  // If there's a tenant name with "Fizah" or "Hanif" that is NOT the one we found
  console.log("\nSearching for other tenants that might match...");
  const { data: allTenants } = await supabase.from("tenants").select("*");
  allTenants.forEach(t => {
    if (t.name.toLowerCase().includes("fizah") || t.name.toLowerCase().includes("hanif")) {
      console.log(`Possible match: ${t.id} - ${t.name}`);
    }
  });
}

debugContacts();
