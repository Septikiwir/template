import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type IncomingContact = {
  id?: unknown;
  nama?: unknown;
  nomor?: unknown;
  is_vip?: unknown;
  is_sent?: unknown;
  is_present?: unknown;
  present_at?: unknown;
  token?: unknown;
};

const generateToken = () => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let result = "";
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

const sanitizeNomor = (value: string) => {
  let cleaned = value.replace(/[^\d]/g, "");
  if (cleaned.startsWith("0")) {
    cleaned = `62${cleaned.slice(1)}`;
  }
  return cleaned;
};

function normalizeContact(contact: IncomingContact) {
  const nama = typeof contact.nama === "string" ? contact.nama.trim() : "";
  const nomorRaw = typeof contact.nomor === "string" ? contact.nomor.trim() : "";
  const nomor = sanitizeNomor(nomorRaw);
  const id = typeof contact.id === "number" ? contact.id : undefined;
  const is_vip = typeof contact.is_vip === "boolean" ? contact.is_vip : false;
  const is_sent = typeof contact.is_sent === "boolean" ? contact.is_sent : false;
  const is_present = typeof contact.is_present === "boolean" ? contact.is_present : false;
  const present_at = typeof contact.present_at === "string" ? contact.present_at : null;
  const token = typeof contact.token === "string" ? contact.token : generateToken();

  if (!nama || !nomor) {
    return null;
  }

  const result: any = { nama, nomor, is_vip, is_sent, is_present, present_at, token };
  if (id !== undefined) {
    result.id = id;
  }
  
  return result;
}

function getSupabaseUserClient(request: Request) {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.split(" ")[1];
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });
}

export async function GET(request: Request) {
  try {
    const supabase = getSupabaseUserClient(request);
    if (!supabase) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data, error } = await supabase
      .from("contacts")
      .select("id, nama, nomor, created_at, is_vip, is_sent, is_present, present_at, token")
      .order("created_at", { ascending: false });

    if (error) {
      throw error;
    }

    return NextResponse.json({ contacts: data ?? [] });
  } catch (error: any) {
    console.error("DEBUG API ERROR GET:", error);
    return NextResponse.json({ error: error.message || "Gagal mengambil kontak." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const supabase = getSupabaseUserClient(request);
    if (!supabase) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload = (await request.json()) as { contacts?: IncomingContact[] };
    const contactsRaw = Array.isArray(payload.contacts) ? payload.contacts : [];

    if (contactsRaw.length === 0) {
      return NextResponse.json({ error: "Data kontak kosong." }, { status: 400 });
    }

    const normalizedContacts = contactsRaw
      .map((contact) => normalizeContact(contact))
      .filter((contact) => contact !== null)
      .map(c => ({ ...c, user_id: user.id }));

    if (normalizedContacts.length === 0) {
      return NextResponse.json({ error: "Tidak ada kontak valid untuk disimpan." }, { status: 400 });
    }

    const dedupedByNomor = Array.from(
      new Map(normalizedContacts.map((contact) => [contact.nomor, contact])).values()
    );

    const { error: upsertError } = await supabase
      .from("contacts")
      .upsert(dedupedByNomor, { onConflict: "user_id,nomor" });

    if (upsertError) {
      throw upsertError;
    }

    const { data, error: selectError } = await supabase
      .from("contacts")
      .select("id, nama, nomor, created_at, is_vip, is_sent, is_present, present_at, token")
      .order("created_at", { ascending: false });

    if (selectError) {
      throw selectError;
    }

    return NextResponse.json({ 
      contacts: data ?? [],
      savedCount: dedupedByNomor.length 
    });
  } catch (error: any) {
    console.error("DEBUG API ERROR POST:", error);
    const errorMessage = error.message || error.details || "Terjadi kesalahan pada server.";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
