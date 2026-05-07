
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase env vars')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function checkAndAddColumn() {
  console.log('Checking settings table...')
  
  // Try to select the column
  const { data, error } = await supabase
    .from('settings')
    .select('display_show_vip_bar')
    .limit(1)

  if (error) {
    if (error.code === '42703') { // undefined_column
      console.log('Column display_show_vip_bar does not exist. Attempting to add it...')
      
      // We can't easily run ALTER TABLE via the client unless we have a RPC or something.
      // But we can try to use a dummy upsert and see what happens.
      console.error('Cannot add column via client. Please add display_show_vip_bar (boolean, default true) to settings table.')
    } else {
      console.error('Error checking column:', error)
    }
  } else {
    console.log('Column display_show_vip_bar already exists.')
  }
}

checkAndAddColumn()
