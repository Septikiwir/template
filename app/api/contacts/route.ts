import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth/session";
import { listContacts } from "@/lib/dal/contacts";
import { requireTenant } from "@/lib/rbac/guards";

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

  if (!nama) {
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

async function sendToN8N(payload: any) {
  const url = process.env.N8N_WEBHOOK_URL;
  const secret = process.env.N8N_SECRET;

  if (!url) {
    console.error("[DEBUG] Error: N8N_WEBHOOK_URL tidak ditemukan di environment variables!");
    return;
  }

  console.log(`[DEBUG] Mengirim webhook ke n8n: ${url} untuk tamu: ${payload.name}`);

  fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": secret || "",
    },
    body: JSON.stringify(payload),
  })
    .then((res) => {
      if (!res.ok) {
        console.error(`[DEBUG] n8n merespon dengan status: ${res.status}`);
      } else {
        console.log(`[DEBUG] Webhook berhasil terkirim ke n8n (Status 200)`);
      }
    })
    .catch((error) => {
      console.error("[DEBUG] Gagal menghubungi n8n:", error.message);
    });
}

function formatPhone(phone: string) {
  if (phone.startsWith("0")) {
    return "62" + phone.slice(1);
  }
  return phone;
}

function getCoupleNameFromSession(user: any): string {
  const email = user?.email;

  if (!email) return "Pengantin";

  const namePart = email.split("@")[0];

  if (!namePart) return "Pengantin";

  return namePart.charAt(0).toUpperCase() + namePart.slice(1);
}

const getErrorStatus = (message?: string) => {
  if (message === "Unauthorized") return 401;
  if (message === "Forbidden") return 403;
  if (message === "Tenant required") return 400;
  return 500;
};

export async function GET(request: Request) {
  try {
    const context = await getSessionContext(request, {
      allowSuperadminTenantFromRequest: true,
    });

    if (!context.isSuperadmin && !context.tenantId) {
      return NextResponse.json({ error: "Tenant required" }, { status: 400 });
    }

    const { data, error } = await listContacts(context.supabase, {
      tenantId: context.tenantId,
      isSuperadmin: context.isSuperadmin,
    });

    if (error) {
      throw error;
    }

    return NextResponse.json({ contacts: data ?? [] });
  } catch (error: any) {
    const message = error?.message;
    const status = getErrorStatus(message);
    if (status !== 500) {
      return NextResponse.json({ error: message }, { status });
    }
    console.error("DEBUG API ERROR GET:", error);
    return NextResponse.json({ error: message || "Gagal mengambil kontak." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const context = await getSessionContext(request, {
      allowSuperadminTenantFromRequest: true,
    });
    requireTenant(context);

    const supabase = context.supabase;

    // Fetch user for couple name
    const { data: { user } } = await supabase.auth.getUser();
    const coupleName = getCoupleNameFromSession(user);

    const payload = (await request.json()) as { action?: string; contacts?: IncomingContact[] };
    const contactsRaw = Array.isArray(payload.contacts) ? payload.contacts : [];
    const isCheckinAction = payload.action === "checkin";

    if (contactsRaw.length === 0) {
      return NextResponse.json({ error: "Data kontak kosong." }, { status: 400 });
    }

    const normalizedContacts = contactsRaw
      .map((contact) => normalizeContact(contact))
      .filter((contact) => contact !== null)
      .map(c => ({ ...c, user_id: context.userId, tenant_id: context.tenantId }));

    if (normalizedContacts.length === 0) {
      return NextResponse.json({ error: "Tidak ada kontak valid untuk disimpan." }, { status: 400 });
    }

    // 1. Dapatkan nomor telepon unik dari payload
    const nomors = Array.from(new Set(normalizedContacts.map(c => c.nomor)));

    // 2. Cek data yang sudah ada di DB
    const { data: existing, error: existingError } = await supabase
      .from("contacts")
      .select("nomor, token, is_present, present_at")
      .eq("tenant_id", context.tenantId)
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
            .eq("tenant_id", context.tenantId)
            .eq("nomor", target.nomor)
            .or("is_present.eq.false,is_present.is.null")
            .select("id");

          if (updateError) {
            throw updateError;
          }

          if (!updatedRows || updatedRows.length === 0) {
            // Kemungkinan sudah di-check-in oleh request lain (race) atau record tidak match.
            alreadyPresent.push(target.nomor);
          } else {
            // SUCCESS: Trigger outgoing webhook to n8n (fire-and-forget)
            sendToN8N({
              tenant_id: context.tenantId,
              guest_id: updatedRows[0].id,
              name: target.nama,
              phone: formatPhone(target.nomor),
              couple: coupleName,
              present_at: target.present_at,
            });
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
      const { data, error: selectError } = await listContacts(supabase, {
        tenantId: context.tenantId,
        isSuperadmin: context.isSuperadmin,
      });

      if (selectError) throw selectError;

      // Broadcast change
      const channel = supabase.channel(`sync:${context.tenantId}`);
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          channel.send({
            type: 'broadcast',
            event: 'sync-data',
            payload: { type: 'CONTACTS_UPDATED', action: 'checkin', sender: context.userId }
          });
        }
      });

      return NextResponse.json({ 
        contacts: data ?? [],
        savedCount: checkinTargets.length
      });
    }

    // 2c. Dapatkan semua token yang sudah terpakai di tenant ini untuk pengecekan duplikasi
    const { data: allTokensData } = await supabase
      .from("contacts")
      .select("token")
      .eq("tenant_id", context.tenantId);
    
    const usedTokens = new Set(allTokensData?.map(t => t.token) || []);

    // 3. Pastikan setiap kontak memiliki token (gunakan yang lama jika ada, atau generate baru yang unik)
    const finalContacts = normalizedContacts.map(c => {
      const existingToken = existingTokenMap.get(c.nomor);
      const currentToken = c.token || existingToken;

      if (currentToken) {
        return { ...c, token: currentToken };
      }

      // Generate token baru dan pastikan belum pernah dipakai
      let newToken;
      let attempts = 0;
      do {
        newToken = generateToken();
        attempts++;
        // Safety break untuk menghindari infinite loop jika kombinasi habis (sangat tidak mungkin)
        if (attempts > 1000) break;
      } while (usedTokens.has(newToken));

      usedTokens.add(newToken); // Tandai sebagai terpakai untuk iterasi berikutnya
      return { ...c, token: newToken };
    });

    const dedupedByNomor = Array.from(
      new Map(finalContacts.map((contact) => [contact.nomor, contact])).values()
    );

    if (dedupedByNomor.length > 0) {
      const { error: upsertError } = await supabase
        .from("contacts")
        .upsert(dedupedByNomor, { onConflict: "tenant_id,nomor" });

      if (upsertError) {
        throw upsertError;
      }
    }

    const { data, error: selectError } = await listContacts(supabase, {
      tenantId: context.tenantId,
      isSuperadmin: context.isSuperadmin,
    });

    if (selectError) {
      throw selectError;
    }

    // Broadcast change
    const channel = supabase.channel(`sync:${context.tenantId}`);
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        channel.send({
          type: 'broadcast',
          event: 'sync-data',
          payload: { type: 'CONTACTS_UPDATED', action: 'mutation', sender: context.userId }
        });
      }
    });

    return NextResponse.json({ 
      contacts: data ?? [],
      savedCount: dedupedByNomor.length
    });
  } catch (error: any) {
    const errorMessage = error.message || error.details || "Terjadi kesalahan pada server.";
    const status = getErrorStatus(errorMessage);
    if (status !== 500) {
      return NextResponse.json({ error: errorMessage }, { status });
    }
    console.error("DEBUG API ERROR POST:", error);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const context = await getSessionContext(request, {
      allowSuperadminTenantFromRequest: true,
    });
    requireTenant(context);

    const supabase = context.supabase;

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "ID tamu wajib diisi." }, { status: 400 });
    }

    const { error } = await supabase
      .from("contacts")
      .delete()
      .eq("id", id)
      .eq("tenant_id", context.tenantId);

    if (error) {
      throw error;
    }

    // Broadcast change
    const channel = supabase.channel(`sync:${context.tenantId}`);
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        channel.send({
          type: 'broadcast',
          event: 'sync-data',
          payload: { type: 'CONTACTS_UPDATED', action: 'delete', id, sender: context.userId }
        });
      }
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    const errorMessage = error.message || "Gagal menghapus kontak.";
    const status = getErrorStatus(errorMessage);
    if (status !== 500) {
      return NextResponse.json({ error: errorMessage }, { status });
    }
    console.error("DEBUG API ERROR DELETE:", error);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
