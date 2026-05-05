import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://lguqxvowpecbdercxsye.supabase.co";
const serviceRoleKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxndXF4dm93cGVjYmRlcmN4c3llIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzI4MDAwNSwiZXhwIjoyMDkyODU2MDA1fQ.p28lvyUeoyxgGcYZm0WD2aIUmyAMTBcCDXcxY3ZnQT4";

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function deleteContacts() {
  const targetTenantId = "11111111-1111-1111-1111-111111111111";
  
  console.log(`Deleting contacts for tenant ID: ${targetTenantId}...`);
  
  const { data, error, count } = await supabase
    .from("contacts")
    .delete({ count: 'exact' })
    .eq("tenant_id", targetTenantId);

  if (error) {
    console.error("Error deleting contacts:", error.message);
    return;
  }

  console.log(`Successfully deleted ${count} contacts.`);
}

deleteContacts();
