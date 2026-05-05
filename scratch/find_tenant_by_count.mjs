import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://lguqxvowpecbdercxsye.supabase.co";
const serviceRoleKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxndXF4dm93cGVjYmRlcmN4c3llIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzI4MDAwNSwiZXhwIjoyMDkyODU2MDA1fQ.p28lvyUeoyxgGcYZm0WD2aIUmyAMTBcCDXcxY3ZnQT4";

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function findTenantWith38Contacts() {
  console.log("Fetching all contacts grouped by tenant_id...");
  
  // Get counts per tenant_id
  const { data, error } = await supabase
    .from("contacts")
    .select("tenant_id");

  if (error) {
    console.error("Error fetching contacts:", error.message);
    return;
  }

  const counts = {};
  data.forEach(c => {
    counts[c.tenant_id] = (counts[c.tenant_id] || 0) + 1;
  });

  console.log("Counts per tenant_id:");
  console.table(counts);

  const targetTenantIds = Object.keys(counts).filter(id => counts[id] === 38);

  if (targetTenantIds.length === 0) {
    console.log("\nNo tenant found with exactly 38 contacts.");
    // Let's see if there's one close to it
    const closest = Object.entries(counts).sort((a, b) => Math.abs(a[1] - 38) - Math.abs(b[1] - 38))[0];
    if (closest) {
      console.log(`Closest tenant has ${closest[1]} contacts (ID: ${closest[0]})`);
    }
  } else {
    console.log("\nFound tenants with 38 contacts:");
    for (const id of targetTenantIds) {
      const { data: tenant } = await supabase.from("tenants").select("name").eq("id", id).single();
      console.log(`ID: ${id}, Name: ${tenant?.name || 'Unknown'}`);
    }
  }
}

findTenantWith38Contacts();
