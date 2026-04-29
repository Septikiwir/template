# SaaS Multi-Tenant Testing Guide

## Prerequisites

1. **Schema Applied**: Run `supabase/schema.sql` in Supabase SQL Editor
2. **Backfill Executed**: Run `supabase/backfill_seed.sql` to populate test data
3. **Dev Server**: `npm run dev` (running on http://localhost:3000)
4. **Test Credentials**:
   - **Username**: `fizah-hanif`
   - **Password**: `17 mei 2026` (or your actual password from Supabase Auth)
   - **Internal Email**: `fizah-hanif@wedding.com`

---

## Test Flow 1: Login & Role-Based Redirect

### Objective
Verify that login redirects users to the correct dashboard based on their role.

### Steps

1. **Open app**: Go to http://localhost:3000
2. **Login as User (Tenant A)**:
   - Username: `fizah-hanif`
   - Password: `17 mei 2026`
   - Expected: Redirects to `/dashboard` (user view)
   - URL should show: `http://localhost:3000/dashboard`

3. **Logout**: Click "Logout" button

4. **Login as Admin (Tenant B)**:
   - Currently, `fizah-hanif` has both roles (user in A, admin in B)
   - The system redirects to the **first matching role** (user > admin > superadmin)
   - Expected redirect: `/dashboard` (because user takes priority)
   - To test admin redirect, you need a separate test account with **only admin role**

### Expected Behavior
- ✅ User role → `/dashboard`
- ✅ Admin role → `/admin`
- ✅ Superadmin role → `/superadmin`

---

## Test Flow 2: Data Isolation Between Tenants

### Objective
Verify that a user in Tenant A cannot see data from Tenant B.

### Setup
- Login as `fizah-hanif` (user in Tenant A, admin in Tenant B)
- Tenant A has 3 contacts: Budi, Siti, Ahmad
- Tenant B has 3 contacts: Hana, Rani, Dwi

### Steps

1. **Check /api/contacts for Tenant A**:
   ```bash
   curl -X GET http://localhost:3000/api/contacts \
     -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
   ```
   - Expected: Returns only Tenant A contacts (Budi, Siti, Ahmad)
   - Default tenant is Tenant A for this user

2. **Attempt to access Tenant B via header**:
   ```bash
   curl -X GET http://localhost:3000/api/contacts \
     -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
     -H "x-tenant-id: 22222222-2222-2222-2222-222222222222"
   ```
   - Expected (as admin in B): Returns Tenant B contacts (Hana, Rani, Dwi)
   - Expected (as user in B, not a member): Returns 403 Forbidden

3. **Verify RLS Policy Enforcement**:
   - Try to insert a contact into Tenant A:
   ```bash
   curl -X POST http://localhost:3000/api/contacts \
     -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"contacts": [{"nama": "Test User", "nomor": "628111111111"}]}'
   ```
   - Expected: Contact is saved to default tenant (Tenant A), not Tenant B

4. **Verify Deletion Isolation**:
   - Try to delete Tenant B contact from Tenant A session:
   ```bash
   curl -X DELETE "http://localhost:3000/api/contacts?id=CONTACT_ID" \
     -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
   ```
   - If ID belongs to Tenant B but user is in Tenant A: 404 Not Found (or 0 rows affected)

### Expected Behavior
- ✅ User only sees own tenant contacts
- ✅ Admin can access tenant-specific contacts when tenant_id is in header
- ✅ Contacts cannot be modified across tenant boundaries
- ✅ RLS policies enforce isolation at database level

---

## Test Flow 3: Role-Based Access Control

### Objective
Verify that RBAC guards prevent unauthorized access.

### Steps

1. **Test Admin Route as User**:
   - Navigate to http://localhost:3000/admin
   - Expected: Redirected to `/dashboard` (RoleGuard component)
   - Dev console should show fetch to `/api/me` returning `role: "user"`

2. **Test Superadmin Route as User**:
   - Navigate to http://localhost:3000/superadmin
   - Expected: Redirected to `/dashboard`

3. **Test User Route as Admin** (requires separate admin account):
   - Navigate to http://localhost:3000/dashboard
   - Expected: Redirected to `/admin`

4. **Verify API-Level Guards**:
   ```bash
   # Attempt superadmin-only operation as regular user
   curl -X POST http://localhost:3000/api/tenants \
     -H "Authorization: Bearer USER_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"name": "New Tenant"}'
   ```
   - Expected: 403 Forbidden

### Expected Behavior
- ✅ Route guards prevent role escalation
- ✅ `<RoleGuard allowed={["admin"]}>` blocks unauthorized users
- ✅ API guards validate role before processing requests
- ✅ Redirects are seamless and don't flash restricted content

---

## Test Flow 4: Session Context & Tenant Scoping

### Objective
Verify that `/api/me` correctly resolves session and tenant context.

### Steps

1. **Call /api/me**:
   ```bash
   curl http://localhost:3000/api/me \
     -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
   ```
   - Expected response:
   ```json
   {
     "role": "user",
     "tenantId": "11111111-1111-1111-1111-111111111111",
     "isSuperadmin": false
   }
   ```

2. **Call /api/me with admin tenant header**:
   ```bash
   curl http://localhost:3000/api/me \
     -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
     -H "x-tenant-id: 22222222-2222-2222-2222-222222222222"
   ```
   - Expected (as admin in B):
   ```json
   {
     "role": "admin",
     "tenantId": "22222222-2222-2222-2222-222222222222",
     "isSuperadmin": false
   }
   ```

3. **Verify Realtime Subscription**:
   - Open two browser tabs, both logged in as `fizah-hanif`
   - Add a new contact in Tab 1 via the UI
   - Expected: Tab 2 auto-updates with the new contact in real-time
   - Verify Supabase realtime channel is scoped to tenant

### Expected Behavior
- ✅ `/api/me` resolves correct role and tenant
- ✅ Tenant can be overridden via `x-tenant-id` header (admin only)
- ✅ Realtime updates are tenant-scoped

---

## Test Flow 5: Error Handling & Edge Cases

### Steps

1. **Missing Bearer Token**:
   ```bash
   curl http://localhost:3000/api/contacts
   ```
   - Expected: 401 Unauthorized

2. **Invalid Tenant ID**:
   ```bash
   curl http://localhost:3000/api/contacts \
     -H "Authorization: Bearer TOKEN" \
     -H "x-tenant-id: 00000000-0000-0000-0000-000000000000"
   ```
   - Expected: 403 Forbidden (user not a member)

3. **Logout & Redirect**:
   - Click "Logout"
   - Expected: Session clears, redirected to login
   - Next login should re-check role and redirect correctly

4. **Stale Session Token**:
   - Let token expire (or manually invalidate)
   - Try to fetch `/api/contacts`
   - Expected: 401 Unauthorized

### Expected Behavior
- ✅ All auth errors return proper HTTP statuses
- ✅ No sensitive data leaked in error messages
- ✅ Graceful fallback to login on auth failure

---

## Verification Checklist

### Authentication & Routing
- [ ] User logs in and is redirected to `/dashboard`
- [ ] Admin logs in and is redirected to `/admin`
- [ ] Superadmin logs in and is redirected to `/superadmin`
- [ ] Logout clears session and redirects to login

### Data Isolation
- [ ] User in Tenant A sees only Tenant A contacts
- [ ] User in Tenant A cannot access Tenant B contacts via API
- [ ] User in Tenant A cannot delete Tenant B contacts
- [ ] Admin can switch tenants via `x-tenant-id` header

### Role-Based Access
- [ ] User cannot navigate to `/admin` or `/superadmin`
- [ ] Admin cannot make superadmin-only API calls
- [ ] Role is validated on every API request (backend guard)
- [ ] Frontend route guards prevent unauthorized navigation

### Database & RLS
- [ ] RLS policies enforce tenant isolation in Supabase
- [ ] Contacts unique constraint is `(tenant_id, nomor)`, not `(user_id, nomor)`
- [ ] app_users and tenant_memberships are properly linked
- [ ] Backfill script populates test data without errors

### Realtime & UI
- [ ] Changes made in one tab appear in another (tenant-scoped)
- [ ] Dashboard stats reflect only tenant-scoped data
- [ ] No console errors or permission warnings

---

## Troubleshooting

### Issue: 401 Unauthorized on /api/me
- **Cause**: Bearer token invalid or missing
- **Fix**: Re-login and verify token is passed in Authorization header

### Issue: 400 Tenant required
- **Cause**: User has no default_tenant_id and no x-tenant-id header
- **Fix**: Ensure backfill script ran and user is assigned to tenants

### Issue: RLS violation errors
- **Cause**: Old RLS policies from schema v1 still active
- **Fix**: Run schema.sql again to drop and recreate policies

### Issue: Data still scoped by user_id
- **Cause**: Old code still filtering by user_id instead of tenant_id
- **Fix**: Verify contacts API uses `eq("tenant_id", ...)` not `eq("user_id", ...)`

### Issue: Redirect loop on login
- **Cause**: `/api/me` is failing or returning null role
- **Fix**: Check browser console for fetch errors; verify backfill completed

---

## Next Steps

1. ✅ Apply schema + backfill
2. ✅ Start dev server
3. ✅ Run flow checks (see above)
4. ✅ Document any issues found
5. 🔜 (Optional) Add dedicated test/admin accounts with only one role
6. 🔜 (Optional) Implement audit logging for superadmin actions
7. 🔜 (Optional) Add tenant invite/signup flow
