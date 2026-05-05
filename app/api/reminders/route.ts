import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { listContacts } from "@/lib/dal/contacts";
import { getSessionContext } from "@/lib/auth/session";

export const runtime = "nodejs";

/**
 * API Reminders dengan Dual Mode:
 * 1. Mode N8N: Menggunakan x-api-key dan tenantId di query param.
 * 2. Mode User: Menggunakan session login (Bearer Token).
 */
export async function GET(request: NextRequest) {
  try {
    const apiKey = request.headers.get("x-api-key");
    const secretKey = process.env.N8N_API_KEY;

    // ✅ MODE N8N / AUTOMATION
    if (secretKey && apiKey === secretKey) {
      const { searchParams } = new URL(request.url);
      const tenantId = searchParams.get("tenantId");

      if (!tenantId) {
        return NextResponse.json({ error: "tenantId required" }, { status: 400 });
      }

      // Gunakan Admin Client untuk bypass RLS dalam mode otomasi
      const supabase = getSupabaseAdmin();
      const { data, error } = await listContacts(supabase, {
        tenantId,
        isSuperadmin: true,
      });

      if (error) {
        console.error("[REMINDER_API] N8N Mode Error:", error);
        return NextResponse.json({ error }, { status: 400 });
      }

      return NextResponse.json(data);
    }

    // ✅ MODE NORMAL (USER LOGIN)
    // Jika tidak ada API key yang cocok, coba validasi lewat session user
    try {
      const context = await getSessionContext(request);

      const { data, error } = await listContacts(context.supabase, {
        tenantId: context.tenantId,
        isSuperadmin: context.isSuperadmin,
      });

      if (error) {
        console.error("[REMINDER_API] User Mode Error:", error);
        return NextResponse.json({ error }, { status: 400 });
      }

      return NextResponse.json(data);
    } catch (authError) {
      // Jika ada API key tapi salah, atau session tidak valid
      if (apiKey && apiKey !== secretKey) {
        return NextResponse.json({ error: "Invalid API Key" }, { status: 401 });
      }
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

  } catch (error: any) {
    console.error("FULL ERROR:", error); // tampil di terminal

    return NextResponse.json(
      { error: error.message || error.toString() }, // kirim ke n8n
      { status: 500 }
    );
  }
}
