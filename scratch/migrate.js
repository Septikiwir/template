
const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase env vars');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function runMigration() {
  console.log('Attempting to add column display_show_vip_bar to settings table...');
  
  // Since we cannot run raw SQL via the client without a function,
  // we'll try to use the REST API to run SQL if the user has it enabled (unlikely)
  // or we'll just try to upsert and see.
  
  // Actually, I can try to use a dummy upsert with the new column.
  // If the column doesn't exist, it will fail.
  
  // BUT wait, I can try to use a fetch to the SQL endpoint if I have the key.
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${supabaseKey}`,
      'apikey': supabaseKey
    },
    body: JSON.stringify({
      sql: 'ALTER TABLE settings ADD COLUMN IF NOT EXISTS display_show_vip_bar BOOLEAN DEFAULT TRUE;'
    })
  });

  if (response.ok) {
    console.log('Migration successful (or rpc exists)');
  } else {
    const text = await response.text();
    console.log('Migration failed (rpc might not exist):', text);
    console.log('Please run this SQL in your Supabase SQL Editor:');
    console.log('ALTER TABLE settings ADD COLUMN IF NOT EXISTS display_show_vip_bar BOOLEAN DEFAULT TRUE;');
  }
}

runMigration();
