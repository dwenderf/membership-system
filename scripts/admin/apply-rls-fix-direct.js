const { Client } = require('pg')

// Use PostgreSQL connection string approach
const connectionString = 'postgresql://postgres.qojixnzpfkpteakltdoa:PEyEe28QDL3yq6SH@aws-0-us-west-1.pooler.supabase.com:6543/postgres'

async function applyRLSFix() {
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  })
  
  try {
    await client.connect()
    console.log('🔧 Connected to database, applying RLS fix...\n')
    
    // Check if policy already exists
    const checkResult = await client.query(`
      SELECT * FROM pg_policies 
      WHERE schemaname = 'public' 
      AND tablename = 'user_registrations' 
      AND policyname = 'Anyone can count paid registrations'
    `)
    
    if (checkResult.rows.length > 0) {
      console.log('Policy already exists, dropping it first...')
      await client.query(`
        DROP POLICY IF EXISTS "Anyone can count paid registrations" ON user_registrations;
      `)
    }
    
    // Create the new policy
    await client.query(`
      CREATE POLICY "Anyone can count paid registrations" ON user_registrations
      FOR SELECT USING (payment_status = 'paid');
    `)
    
    console.log('✅ RLS policy applied successfully!')
    
  } catch (error) {
    console.error('Error:', error)
  } finally {
    await client.end()
  }
}

applyRLSFix().catch(console.error)