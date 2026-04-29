import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type TenantScope = {
  tenantId?: string;
  isSuperadmin: boolean;
};

export const CONTACT_SELECT_FIELDS =
  "id, nama, nomor, created_at, priority, kategori, is_sent, is_present, present_at, token, added_via";

export function applyTenantScope(query: any, scope: TenantScope) {
  if (!scope.isSuperadmin || scope.tenantId) {
    if (!scope.tenantId) {
      return query;
    }
    return query.eq("tenant_id", scope.tenantId);
  }

  return query;
}

export function listContacts(supabase: SupabaseClient, scope: TenantScope) {
  const query = supabase
    .from("contacts")
    .select(CONTACT_SELECT_FIELDS)
    .order("created_at", { ascending: false });

  return applyTenantScope(query, scope);
}
