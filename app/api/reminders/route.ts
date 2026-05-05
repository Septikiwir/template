import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { listContacts } from "@/lib/dal/contacts";

export const runtime = "nodejs";

/**
 * API Khusus untuk otomasi (seperti n8n) untuk mengambil data tamu.
 * Menggunakan API Key untuk autentikasi dan tenantId melalui query parameter.
 */
export async function GET(request: NextRequest) {
  try {
    // 1. Validasi API Key khusus
    const apiKey = request.headers.get("x-api-key");
    const secretKey = process.env.N8N_API_KEY;

    if (!secretKey) {
      console.error("[REMINDER_API] Error: N8N_API_KEY tidak dikonfigurasi di environment variables.");
      return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
    }

    if (apiKey !== secretKey) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. Ambil tenantId dari query parameter
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId");

    if (!tenantId) {
      return NextResponse.json({ error: "Parameter 'tenantId' wajib diisi." }, { status: 400 });
    }

    // 3. Inisialisasi Supabase Admin (untuk bypass RLS karena ini internal automation)
    const supabase = getSupabaseAdmin();

    // 4. Ambil data kontak menggunakan DAL yang sudah ada
    // Kita set isSuperadmin: true agar filter tenant_id bisa kita tentukan sendiri via query param
    const { data, error } = await listContacts(supabase, {
      tenantId,
      isSuperadmin: true,
    });

    if (error) {
      console.error("[REMINDER_API] Error fetching contacts:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ total: 0, contacts: [] });
    }

    // 5. Kembalikan semua data tamu untuk tenant tersebut
    return NextResponse.json({
      success: true,
      tenantId,
      total: data.length,
      contacts: data,
    });
  } catch (error: any) {
    console.error("[REMINDER_API] Unexpected error:", error);
    return NextResponse.json(
      { error: "Terjadi kesalahan pada server." },
      { status: 500 }
    );
  }
}
