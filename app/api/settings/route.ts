import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth/session";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const context = await getSessionContext(request, {
      allowSuperadminTenantFromRequest: true,
    });

    if (!context.tenantId && !context.isSuperadmin) {
      return NextResponse.json({ error: "Tenant required" }, { status: 400 });
    }

    const { data, error } = await context.supabase
      .from("settings")
      .select("link, pesan, include_token, display_welcome_text, display_bg_color, display_bg_type, display_bg_url, display_font_color, display_show_vip_bar")
      .eq("tenant_id", context.tenantId)
      .single();

    if (error && error.code !== "PGRST116") { // PGRST116 is "No rows found"
      throw error;
    }

    return NextResponse.json({ settings: data || null });
  } catch (error: any) {
    console.error("DEBUG API ERROR GET SETTINGS:", error);
    return NextResponse.json({ error: error.message || "Gagal mengambil pengaturan." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const context = await getSessionContext(request, {
      allowSuperadminTenantFromRequest: true,
    });

    if (!context.tenantId) {
      return NextResponse.json({ error: "Tenant required" }, { status: 400 });
    }

    const payload = await request.json();
    const { link, pesan, include_token, display_welcome_text, display_bg_color, display_bg_type, display_bg_url, display_font_color, display_show_vip_bar } = payload;

    const { data, error } = await context.supabase
      .from("settings")
      .upsert({
        tenant_id: context.tenantId,
        link,
        pesan,
        include_token,
        display_welcome_text,
        display_bg_color,
        display_bg_type,
        display_bg_url,
        display_font_color,
        display_show_vip_bar,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ settings: data });
  } catch (error: any) {
    console.error("DEBUG API ERROR POST SETTINGS:", error);
    return NextResponse.json({ error: error.message || "Gagal menyimpan pengaturan." }, { status: 500 });
  }
}
