import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type IncomingContact = {
  id?: unknown;
  nama?: unknown;
  nomor?: unknown;
  priority?: unknown;
  kategori?: unknown;
  is_sent?: unknown;
  is_present?: unknown;
  present_at?: unknown;
  token?: unknown;
  added_via?: unknown;
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
  const nomorRaw = contact.nomor != null ? String(contact.nomor).trim() : "";
  const nomor = sanitizeNomor(nomorRaw);
  const id = typeof contact.id === "number" ? contact.id : undefined;
  
  // New fields
  const priority = typeof contact.priority === "string" ? contact.priority : "Reguler";
  const kategori = typeof contact.kategori === "string" ? contact.kategori : "-";
  
  const is_sent = typeof contact.is_sent === "boolean" ? contact.is_sent : false;
  const is_present = typeof contact.is_present === "boolean" ? contact.is_present : false;
  const present_at =
    contact.present_at === null
      ? null
      : typeof contact.present_at === "string"
        ? contact.present_at
        : undefined;
  const token = typeof contact.token === "string" ? contact.token : undefined;
  const added_via = typeof contact.added_via === "string" ? contact.added_via : undefined;

  if (!nama || !nomor) {
    return null;
  }

  const result: any = { 
    nama, 
    nomor, 
    priority: String(priority), 
    kategori: String(kategori), 
    is_sent, 
    is_present, 
    token 
  };
  if (added_via !== undefined) {
    result.added_via = added_via;
  }
  if (present_at !== undefined) {
    result.present_at = present_at;
  }
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
      .select("id, nama, nomor, created_at, priority, kategori, is_sent, is_present, present_at, token, added_via")
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

    const payload = (await request.json()) as { action?: string; contacts?: IncomingContact[] };
    const contactsRaw = Array.isArray(payload.contacts) ? payload.contacts : [];
    const isCheckinAction = payload.action === "checkin";

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

    // 1. Dapatkan nomor telepon unik dari payload
    const nomors = Array.from(new Set(normalizedContacts.map(c => c.nomor)));

    // 2. Cek data yang sudah ada di DB
    const { data: existing, error: existingError } = await supabase
      .from("contacts")
      .select("nomor, token, is_present, present_at")
      .eq("user_id", user.id)
      .in("nomor", nomors);

    if (existingError) {
      throw existingError;
    }

    const existingByNomor = new Map((existing ?? []).map((row: any) => [row.nomor, row]));

    const existingTokenMap = new Map(existing?.map(e => [e.nomor, e.token]) || []);

    // 2b. Handle check-in secara atomic dan tolak double check-in
    if (isCheckinAction) {
      const checkinTargets = normalizedContacts.filter(
        (c: any) => c.is_present === true && c.present_at != null
      );

      if (checkinTargets.length > 0) {
        const alreadyPresent: string[] = [];
        const notFound: string[] = [];

        for (const target of checkinTargets) {
          const existingRow = existingByNomor.get(target.nomor);
          if (!existingRow) {
            notFound.push(target.nomor);
            continue;
          }

          if (existingRow.is_present === true) {
            alreadyPresent.push(target.nomor);
            continue;
          }

          const { data: updatedRows, error: updateError } = await supabase
            .from("contacts")
            .update({ is_present: true, present_at: target.present_at })
            .eq("user_id", user.id)
            .eq("nomor", target.nomor)
            .or("is_present.eq.false,is_present.is.null")
            .select("id");

          if (updateError) {
            throw updateError;
          }

          if (!updatedRows || updatedRows.length === 0) {
            // Kemungkinan sudah di-check-in oleh request lain (race) atau record tidak match.
            alreadyPresent.push(target.nomor);
          }
        }

        if (notFound.length > 0) {
          return NextResponse.json(
            { error: "Kontak tidak ditemukan untuk check-in.", nomors: notFound },
            { status: 404 }
          );
        }

        if (alreadyPresent.length > 0) {
          return NextResponse.json(
            { error: "Check-in berulang tidak diizinkan.", nomors: alreadyPresent },
            { status: 409 }
          );
        }
      }

      // Jika check-in berhasil, refetch dan return
      const { data, error: selectError } = await supabase
        .from("contacts")
        .select("id, nama, nomor, created_at, priority, kategori, is_sent, is_present, present_at, token, added_via")
        .order("created_at", { ascending: false });

      if (selectError) throw selectError;

      return NextResponse.json({ 
        contacts: data ?? [],
        savedCount: checkinTargets.length
      });
    }

    // 3. Pastikan setiap kontak memiliki token (gunakan yang lama jika ada, atau generate baru jika benar-benar baru)
    const finalContacts = normalizedContacts.map(c => {
      const existingToken = existingTokenMap.get(c.nomor);
      return {
        ...c,
        token: c.token || existingToken || generateToken()
      };
    });

    const dedupedByNomor = Array.from(
      new Map(finalContacts.map((contact) => [contact.nomor, contact])).values()
    );

    if (dedupedByNomor.length > 0) {
      const { error: upsertError } = await supabase
        .from("contacts")
        .upsert(dedupedByNomor, { onConflict: "user_id,nomor" });

      if (upsertError) {
        throw upsertError;
      }
    }

    const { data, error: selectError } = await supabase
      .from("contacts")
      .select("id, nama, nomor, created_at, priority, kategori, is_sent, is_present, present_at, token, added_via")
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

export async function DELETE(request: Request) {
  try {
    const supabase = getSupabaseUserClient(request);
    if (!supabase) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "ID tamu wajib diisi." }, { status: 400 });
    }

    const { error } = await supabase
      .from("contacts")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id);

    if (error) {
      throw error;
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("DEBUG API ERROR DELETE:", error);
    return NextResponse.json({ error: error.message || "Gagal menghapus kontak." }, { status: 500 });
  }
}
