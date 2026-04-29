# Quick Test Execution Plan

## Prerequisites Checklist

Before running tests, ensure:

- [ ] `supabase/schema.sql` applied to Supabase
- [ ] `supabase/backfill_seed.sql` executed (creates tenants + test users)
- [ ] Dev server running on http://localhost:3001
- [ ] .env.local has valid NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY

## Test Credentials

```
Username: fizah-hanif
Password: 17 mei 2026 (or your actual Supabase Auth password)
Internal Email: fizah-hanif@wedding.com
```

## Quick Flow Test (5 minutes)

### Step 1: Login & Redirect ✅

1. Open http://localhost:3001
2. Login with: `fizah-hanif` / `17 mei 2026`
3. **EXPECT**: Redirects to `http://localhost:3001/dashboard`
4. Verify you see user dashboard layout

```
✓ User role detected
✓ Redirect to /dashboard occurred
✓ Dashboard loaded without errors
```

### Step 2: View Contacts (Tenant A) ✅

1. On dashboard, scroll down to contact list
2. **EXPECT**: See sample contacts from Tenant A:
   - Budi Santoso
   - Siti Nurhaliza
   - Ahmad Rahman
3. No Tenant B contacts should appear

```
✓ Contacts filtered by default_tenant_id (Tenant A)
✓ RLS policy applied at DB level
```

### Step 3: API-Level Isolation Test ✅

Open browser **Developer Console** (F12) and run:

```javascript
// Paste this into console after login
async function testTenantIsolation() {
  const { data } = await window.__supabase.auth.getSession();
  const token = data.session?.access_token;
  
  // Test 1: Get default tenant contacts
  const res1 = await fetch('/api/contacts', {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data1 = await res1.json();
  console.log('Default tenant contacts:', data1.contacts.length);
  
  // Test 2: Get Tenant B contacts (admin can switch)
  const res2 = await fetch('/api/contacts', {
    headers: {
      Authorization: `Bearer ${token}`,
      'x-tenant-id': '22222222-2222-2222-2222-222222222222'
    }
  });
  const data2 = await res2.json();
  console.log('Tenant B contacts:', data2.contacts.length);
  
  // Expected:
  // - Default: 3 contacts (Budi, Siti, Ahmad)
  // - Tenant B: 3 contacts (Hana, Rani, Dwi)
}
testTenantIsolation();
```

**EXPECT Output**:
```
Default tenant contacts: 3
Tenant B contacts: 3
```

### Step 4: Role-Based Route Guard ✅

1. In same browser, navigate to http://localhost:3001/admin
2. **EXPECT**: Redirected back to `/dashboard`
3. Check browser console for messages (might see RoleGuard verification)

```
✓ Admin route is protected
✓ User role cannot access /admin
✓ Redirect is automatic
```

### Step 5: Logout ✅

1. Click "Logout" button
2. **EXPECT**: Session clears, redirected to login page
3. Form is empty, ready for new login

```
✓ Session cleared
✓ Auth state reset
```

---

## Manual Testing Commands (curl)

If you prefer terminal testing:

```bash
# Step 1: Get session info
curl http://localhost:3001/api/me \
  -H "Authorization: Bearer YOUR_TOKEN"

# Expected:
# {
#   "role": "user",
#   "tenantId": "11111111-1111-1111-1111-111111111111",
#   "isSuperadmin": false
# }

# Step 2: Get tenant A contacts
curl http://localhost:3001/api/contacts \
  -H "Authorization: Bearer YOUR_TOKEN"

# Step 3: Get tenant B contacts (as admin)
curl http://localhost:3001/api/contacts \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "x-tenant-id: 22222222-2222-2222-2222-222222222222"

# Step 4: Try unauthorized access (should fail)
curl http://localhost:3001/api/contacts \
  -H "Authorization: Bearer INVALID_TOKEN"
# Expected: 401 Unauthorized
```

---

## Troubleshooting

### ❌ Login fails with "Unauthorized"
- Verify Supabase Auth has user: `fizah-hanif@wedding.com`
- Check .env.local has correct NEXT_PUBLIC_SUPABASE keys
- Try password reset in Supabase dashboard

### ❌ No contacts appear on dashboard
- Verify backfill_seed.sql was executed
- Check Supabase SQL Editor: `SELECT * FROM contacts;` should show 6 rows
- Verify user is in tenant_memberships

### ❌ Redirect loop on login
- Check browser console for fetch errors to `/api/me`
- Verify session.ts is not throwing errors
- Try hard refresh (Ctrl+Shift+R)

### ❌ See Tenant B contacts in default view
- RLS not applied correctly
- Re-run schema.sql to recreate policies
- Check: `SELECT * FROM contacts WHERE tenant_id != user's_default_tenant_id;` returns empty

### ❌ Can navigate to /admin as user
- RoleGuard component not mounted
- Check app/admin/page.tsx has `<RoleGuard allowed={["admin"]}>`
- Clear Next.js cache: `rm -rf .next/`

---

## Success Criteria

After running above tests, you should see:

✅ **Authentication**: User logs in with internal email format  
✅ **Role Detection**: `/api/me` returns correct role + tenantId  
✅ **Routing**: After login, redirect matches user role  
✅ **Data Isolation**: User sees only own tenant contacts  
✅ **Access Control**: User cannot navigate to restricted routes  
✅ **API Guards**: Backend enforces tenant + role checks  
✅ **No Errors**: Console is clean, no permission warnings  

If all pass → **Multi-tenant SaaS structure is working!** 🎉

---

## Next: Advanced Testing

See [TESTING.md](../TESTING.md) for:
- Flow 2: Detailed data isolation scenarios
- Flow 3: Role hierarchy and edge cases
- Flow 4: Realtime subscription scoping
- Flow 5: Error handling validation

---

## Notes for Demo/Production

1. **Create separate test accounts** with specific roles:
   - User-only account
   - Admin-only account
   - Superadmin account

2. **Use Supabase SQL Editor** to inspect:
   ```sql
   SELECT * FROM app_users;
   SELECT * FROM tenant_memberships;
   SELECT * FROM contacts;
   ```

3. **Monitor RLS** with Supabase dashboard → Authentication → Policies

4. **Test Rate Limiting** before production (add to API routes)

5. **Enable Audit Logging** for superadmin actions (see IMPLEMENTATION.md)
