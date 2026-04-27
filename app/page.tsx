"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Html5Qrcode } from "html5-qrcode";
import styles from "./page.module.css";
import { supabase } from "@/lib/supabase";
import { type Session } from "@supabase/supabase-js";

type Contact = {
  id: number;
  nama: string;
  nomor: string;
  created_at: string;
  is_vip: boolean;
  is_sent: boolean;
  is_present: boolean;
  present_at: string | null;
  token: string;
};


type SaveResponse = {
  savedCount: number;
  contacts: Contact[];
};

const sanitizeNomor = (value: string) => {
  let cleaned = value.replace(/[^\d]/g, "");
  if (cleaned.startsWith("0")) {
    cleaned = `62${cleaned.slice(1)}`;
  }
  return cleaned;
};

const parseBulkInput = (bulkInput: string) => {
  const lines = bulkInput.split("\n");
  const validContacts: { nama: string; nomor: string }[] = [];
  const invalidLines: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const parts = line.split(/[,\t;]/);
    if (parts.length < 2) {
      invalidLines.push(rawLine);
      continue;
    }

    const nama = parts[0]?.trim() ?? "";
    const nomor = sanitizeNomor(parts[1]?.trim() ?? "");

    if (!nama || !nomor) {
      invalidLines.push(rawLine);
      continue;
    }

    validContacts.push({ nama, nomor });
  }

  return { validContacts, invalidLines };
};

const buildMessage = (template: string, nama: string, link: string, id: string = "TOKEN") => {
  return template
    .replace(/\{nama\}/g, nama)
    .replace(/\{link\}/g, link)
    .replace(/\{id\}/g, id);
};

const formatGuestDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
};

const initialLocal = (key: string) => {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(key) ?? "";
};

export default function Home() {
  const [bulkInput, setBulkInput] = useState("");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [activeView, setActiveView] = useState<"send" | "guestbook">("send");
  const [guestbookQuery, setGuestbookQuery] = useState("");
  const [sentNomors, setSentNomors] = useState<string[]>([]);
  const [isFetching, setIsFetching] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scannedContact, setScannedContact] = useState<Contact | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [link, setLink] = useState(() => initialLocal("wa_sender_link"));
  const [pesan, setPesan] = useState(() => initialLocal("wa_sender_pesan"));
  const [feedback, setFeedback] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [sortConfig, setSortConfig] = useState<{ key: keyof Contact | 'no'; direction: 'asc' | 'desc' }>({ key: 'is_present', direction: 'desc' });

  // Helper to map username to internal email for Supabase Auth
  const getInternalEmail = (user: string) => `${user.trim().toLowerCase()}@wedding.com`;

  const pesanMissingNama = pesan.trim() !== "" && !pesan.includes("{nama}");
  const pesanMissingLink = pesan.trim() !== "" && !pesan.includes("{link}");
  const templateInvalid = !pesan.trim() || !link.trim() || pesanMissingNama || pesanMissingLink;

  // Efek untuk membersihkan notifikasi otomatis setelah 3 detik
  useEffect(() => {
    if (feedback || errorMessage) {
      const timer = setTimeout(() => {
        setFeedback("");
        setErrorMessage("");
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [feedback, errorMessage]);

  const handleUpdateContact = async (updated: Contact) => {
    if (!session) return;
    try {
      setContacts(prev => prev.map(c => 
        c.id === updated.id ? updated : c
      ));

      const response = await fetch("/api/contacts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ 
          contacts: [{ 
            id: updated.id,
            nama: updated.nama,
            nomor: updated.nomor,
            is_vip: updated.is_vip,
            is_sent: updated.is_sent,
            is_present: updated.is_present
          }] 
        }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Gagal memperbarui database.");
      }
      
      setEditingContact(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Gagal menyimpan.";
      setErrorMessage(message);
      handleLoadContacts();
    }
  };

  const handleScanSuccess = async (decodedText: string) => {
    // Bersihkan hasil scan dari spasi atau karakter aneh
    const cleanToken = decodedText.trim();
    
    // Cari tamu berdasarkan token
    const contact = contacts.find(c => c.token === cleanToken);
    
    if (contact) {
      if (contact.is_present) {
        setFeedback(`${contact.nama} sudah hadir sebelumnya.`);
        setScannedContact(contact);
      } else {
        const now = new Date().toISOString();
        const updated = { ...contact, is_present: true, present_at: now };
        
        setFeedback(`BERHASIL: ${contact.nama} hadir!`);
        setScannedContact(updated);
        
        try {
          await handleUpdateContact(updated);
        } catch (err) {
          setErrorMessage("Gagal menyimpan kehadiran.");
        }
      }
    } else {
      setErrorMessage("ID Tamu Tidak Valid: " + decodedText);
    }
  };

  // 1. Handle Ambil Data
  const handleLoadContacts = async () => {
    if (!session) return;
    try {
      setIsFetching(true);
      const response = await fetch("/api/contacts", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: "no-store"
      });
      const data = await response.json();
      if (response.ok) {
        const freshContacts = Array.isArray(data.contacts) ? data.contacts : [];
        setContacts(freshContacts);
        setSentNomors(freshContacts.filter((c: Contact) => c.is_sent).map((c: Contact) => c.nomor));
      }
    } catch (err) {
      console.error("Load Error:", err);
    } finally {
      setIsFetching(false);
    }
  };

  // 2. Auth & Realtime Subscription
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setIsInitializing(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) {
      setContacts([]);
      return;
    }

    // Ambil data awal
    handleLoadContacts();

    // Pasang pendengar Realtime khusus untuk user ini
    const channel = supabase
      .channel(`realtime_contacts_${session.user.id}`)
      .on(
        "postgres_changes",
        { 
          event: "*", 
          schema: "public", 
          table: "contacts",
          filter: `user_id=eq.${session.user.id}` 
        },
        () => {
          // Setiap ada perubahan (INSERT/UPDATE/DELETE), ambil data terbaru
          handleLoadContacts();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [session]);

  // 3. Local Storage Sync
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("wa_sender_link", link);
    }
  }, [link]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("wa_sender_pesan", pesan);
    }
  }, [pesan]);

  const handleAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoginError("");

    if (!username || !password) {
      setLoginError("Nama pengantin dan password wajib diisi.");
      return;
    }

    const internalEmail = getInternalEmail(username);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: internalEmail,
        password,
      });
      if (error) throw error;
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "Terjadi kesalahan autentikasi.");
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setActiveView("send");
    setGuestbookQuery("");
  };


  const handleSaveContacts = async () => {
    if (!session) return;
    setFeedback("");
    setErrorMessage("");

    const { validContacts, invalidLines } = parseBulkInput(bulkInput);

    if (validContacts.length === 0) {
      setErrorMessage("Tidak ada data valid untuk disimpan.");
      return;
    }

    try {
      setIsSaving(true);

      const response = await fetch("/api/contacts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ contacts: validContacts }),
      });

      const data = (await response.json()) as { contacts?: Contact[], savedCount?: number, error?: string };

      if (!response.ok) {
        throw new Error(data.error || "Gagal menyimpan kontak.");
      }

      const savedCount = Number(data.savedCount ?? 0);
      setContacts(Array.isArray(data.contacts) ? data.contacts : []);
      setSentNomors([]);
      setBulkInput("");

      if (invalidLines.length > 0) {
        setFeedback(
          `Berhasil simpan ${savedCount} kontak. ${invalidLines.length} baris diabaikan karena format tidak valid.`
        );
      } else {
        setFeedback(`Berhasil simpan ${savedCount} kontak.`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Terjadi kesalahan.";
      setErrorMessage(message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSendWhatsapp = () => {
    setFeedback("");
    setErrorMessage("");

    if (contacts.length === 0) {
      setErrorMessage("Belum ada kontak untuk dikirim.");
      return;
    }

    if (templateInvalid) {
      setErrorMessage("Lengkapi link dan template. Template wajib berisi {nama} dan {link}.");
      return;
    }

    setIsSending(true);

    const sentUpdates = contacts.map(c => ({
      id: c.id,
      nama: c.nama,
      nomor: c.nomor,
      is_sent: true
    }));

    contacts.forEach((contact, index) => {
      const msg = buildMessage(pesan, contact.nama, link.trim(), contact.token);
      const encoded = encodeURIComponent(msg);
      const waUrl = `https://wa.me/${contact.nomor}?text=${encoded}`;

      setTimeout(() => {
        window.open(waUrl, "_blank");
      }, index * 220);
    });

    // Local update
    setContacts(prev => prev.map(c => ({ ...c, is_sent: true })));
    setSentNomors(contacts.map((contact) => contact.nomor));

    // Persist to DB
    if (session) {
      fetch("/api/contacts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ contacts: sentUpdates }),
      });
    }

    setFeedback(`Membuka ${contacts.length} chat WhatsApp. Pastikan browser mengizinkan pop-up.`);
    setTimeout(() => setIsSending(false), contacts.length * 220 + 300);
  };

  const handleSendSingleContact = (contact: Contact) => {
    if (templateInvalid) {
      setErrorMessage("Lengkapi link dan template. Template wajib berisi {nama} dan {link}.");
      return;
    }

    const waUrl = `https://wa.me/${contact.nomor}?text=${encodeURIComponent(buildMessage(pesan, contact.nama, link, contact.token))}`;
    window.open(waUrl, "_blank");
    
    setContacts(prev => prev.map(c => 
      c.id === contact.id ? { ...c, is_sent: true } : c
    ));
    setSentNomors((prev) => [...new Set([...prev, contact.nomor])]);

    if (session) {
      fetch("/api/contacts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ 
          contacts: [{ 
            id: contact.id,
            nama: contact.nama,
            nomor: contact.nomor,
            is_sent: true 
          }] 
        }),
      });
    }
  };

  const sentCount = sentNomors.length;

  const previewMessage = useMemo(() => {
    if (!pesan.trim()) return "";
    const namaPreview = contacts[0]?.nama ?? "Budi Santoso";
    const linkPreview = link.trim() || "https://contoh.com";
    const idPreview = contacts[0]?.token ?? "ID123";
    return buildMessage(pesan, namaPreview, linkPreview, idPreview);
  }, [contacts, link, pesan]);

  const filteredGuestbook = useMemo(() => {
    const keyword = guestbookQuery.trim().toLowerCase();
    
    // Tahap 1: Saring tamu yang sudah dikirim atau sudah hadir
    let processed = contacts.filter(c => c.is_sent || c.is_present);

    // Tahap 2: Saring berdasarkan pencarian jika ada kata kunci
    if (keyword) {
      processed = processed.filter((contact) => {
        const byName = contact.nama.toLowerCase().includes(keyword);
        const byNumber = contact.nomor.toLowerCase().includes(keyword);
        return byName || byNumber;
      });
    }

    // Tahap 3: Pengurutan (Sorting)
    return [...processed].sort((a, b) => {
      if (sortConfig.key === 'no') return 0; // Biarkan nomor urut tetap
      
      let valA = a[sortConfig.key as keyof Contact];
      let valB = b[sortConfig.key as keyof Contact];

      // Penanganan khusus untuk string
      if (typeof valA === 'string' && typeof valB === 'string') {
        return sortConfig.direction === 'asc' 
          ? valA.localeCompare(valB) 
          : valB.localeCompare(valA);
      }

      // Penanganan untuk boolean atau number
      if (valA! < valB!) return sortConfig.direction === 'asc' ? -1 : 1;
      if (valA! > valB!) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [contacts, guestbookQuery, sortConfig]);

  const toggleSort = (key: keyof Contact | 'no') => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const getSortIcon = (key: keyof Contact | 'no') => {
    if (sortConfig.key !== key) return "↕";
    return sortConfig.direction === 'asc' ? "↑" : "↓";
  };

  if (isInitializing) {
    return <div className={styles.loadingOverlay}>Memuat...</div>;
  }

  if (!session) {
    return (
      <>
        <header className={styles.header}>
          <div className={styles.badge}>
            <span className={styles.badgeDot} />
            Login Pengirim
          </div>
          <h1 className={styles.title}>
            Masuk Dulu
            <br />
            <span className={styles.titleAccent}>Sebelum Kirim.</span>
          </h1>
          <p className={styles.subtitle}>
            Masukkan nama pengantin dan password untuk membuka fitur pengiriman WhatsApp.
          </p>
        </header>

        <div className={styles.card}>
          <form onSubmit={handleAuth}>
            <div className={styles.field}>
              <label htmlFor="username" className={styles.label}>
                Nama Pengantin <span className={styles.req}>*</span>
              </label>
              <div className={styles.inputWrap}>
                <input
                  id="username"
                  type="text"
                  className={styles.input}
                  placeholder="Contoh: Fizah-Hanif"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  required
                />
                <span className={styles.inputIcon}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="8" r="4" />
                    <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
                  </svg>
                </span>
              </div>
            </div>

            <div className={styles.field}>
              <label htmlFor="password" className={styles.label}>
                Password <span className={styles.req}>*</span>
              </label>
              <div className={styles.inputWrap}>
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  className={styles.input}
                  placeholder="Masukkan password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
                <span className={styles.inputIcon}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="11" width="18" height="10" rx="2" />
                    <path d="M7 11V8a5 5 0 0 1 10 0v3" />
                  </svg>
                </span>
                <button
                  type="button"
                  className={styles.eyeBtn}
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? "Sembunyikan password" : "Tampilkan password"}
                >
                  {showPassword ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {loginError && <div className={styles.hintError}>{loginError}</div>}
            {feedback && <div className={styles.hint}>{feedback}</div>}

            <button className={styles.btn} type="submit">
              Login
            </button>
          </form>
        </div>

        <p className={styles.footerNote}>Halaman utama hanya bisa diakses setelah login berhasil.</p>
      </>
    );
  }

  return (
    <>
      <header className={styles.header}>
        <div className={styles.badge}>
          <span className={styles.badgeDot} />
          WhatsApp Message Sender
        </div>
        <h1 className={styles.title}>
          Kirim Pesan
          <br />
          <span className={styles.titleAccent}>Massal.</span>
        </h1>
        <p className={styles.subtitle}>
          Halo, <strong>{username || session.user.email?.split("@")[0]}</strong>. Kelola kontak Anda di sini.
        </p>
        <div className={styles.modeToggle}>
          <button
            className={`${styles.modeBtn} ${activeView === "send" ? styles.modeBtnActive : ""}`}
            onClick={() => setActiveView("send")}
          >
            Send
          </button>
          <button
            className={`${styles.modeBtn} ${activeView === "guestbook" ? styles.modeBtnActive : ""}`}
            onClick={() => setActiveView("guestbook")}
          >
            Buku Tamu
          </button>
        </div>
        <div className={styles.topActions}>
          <button className={styles.ghostBtn} onClick={handleLogout}>
            Logout
          </button>
        </div>
      </header>

      {activeView === "send" ? (
        <div className={styles.card}>
          <div className={styles.field}>
            <label className={styles.label}>
              Input Data Massal <span className={styles.req}>*</span>
            </label>
            <textarea
              className={styles.textarea}
              placeholder={"Budi Santoso, 08123456789\nSiti Aminah, +6281234567890"}
              style={{ minHeight: "150px", paddingLeft: "14px" }}
              value={bulkInput}
              onChange={(e) => setBulkInput(e.target.value)}
            />
            <div className={styles.hint}>Format: Nama, Nomor HP (satu baris per kontak).</div>
            <button
              className={styles.btn}
              style={{ marginTop: "12px", padding: "10px" }}
              onClick={handleSaveContacts}
              disabled={isSaving}
            >
              {isSaving ? "Menyimpan..." : "Simpan Kontak"}
            </button>
          </div>

          <div className={styles.field}>
            <label htmlFor="link" className={styles.label}>
              Link / URL <span className={styles.req}>*</span>
            </label>
            <div className={styles.inputWrap}>
              <input
                id="link"
                type="text"
                className={styles.input}
                placeholder="Contoh: https://link.com"
                autoComplete="off"
                value={link}
                onChange={(e) => setLink(e.target.value)}
              />
              <span className={styles.inputIcon}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
                </svg>
              </span>
            </div>
            {!link.trim() && <div className={styles.hintError}>Link tidak boleh kosong.</div>}
          </div>

          <div className={styles.field}>
            <label htmlFor="pesan" className={styles.label}>
              Template Pesan <span className={styles.req}>*</span>
            </label>
            <div className={styles.inputWrap}>
              <textarea
                id="pesan"
                className={styles.textarea}
                placeholder={"Halo {nama}, ini link undangan Anda: {link}"}
                value={pesan}
                onChange={(e) => setPesan(e.target.value)}
              />
              <span className={`${styles.inputIcon} ${styles.inputIconTextarea}`}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                </svg>
              </span>
            </div>
            <div className={styles.hint}>
              Wajib gunakan <strong>{"{nama}"}</strong> dan <strong>{"{link}"}</strong>.
            </div>
            {!pesan.trim() && <div className={styles.hintError}>Template pesan tidak boleh kosong.</div>}
            {pesanMissingNama && (
              <div className={styles.hintError}>
                Template harus mengandung <strong>{"{nama}"}</strong>
              </div>
            )}
            {pesanMissingLink && (
              <div className={styles.hintError}>
                Template harus mengandung <strong>{"{link}"}</strong>
              </div>
            )}
          </div>

          {previewMessage && (
            <div className={styles.previewSection}>
              <div className={styles.previewLabel}>Pratinjau Pesan</div>
              <div className={styles.previewBox}>{previewMessage}</div>
            </div>
          )}

          {(feedback || errorMessage) && (
            <div className={styles.field}>
              {feedback && <div className={styles.hint}>{feedback}</div>}
              {errorMessage && <div className={styles.hintError}>{errorMessage}</div>}
            </div>
          )}

          <div style={{ marginTop: "2rem" }}>
            <div className={styles.bulkHeader}>
              <span className={styles.bulkTitle}>Daftar Kontak ({contacts.length})</span>
              <div className={styles.rowActions}>
                <span className={styles.bulkStats}>
                  {sentCount} / {contacts.length} Terkirim
                </span>
              </div>
            </div>

            <div className={styles.bulkList}>
              {contacts.length === 0 && !isFetching && (
                <div className={styles.contactRow}>
                  <div className={styles.contactInfo}>
                    <span className={styles.contactName}>Belum ada kontak dimuat</span>
                    <span className={styles.contactNumber}>Tambahkan kontak di atas untuk mulai mengirim.</span>
                  </div>
                </div>
              )}

              {contacts
                .sort((a, b) => {
                  const aSent = sentNomors.includes(a.nomor);
                  const bSent = sentNomors.includes(b.nomor);
                  return aSent === bSent ? 0 : aSent ? 1 : -1;
                })
                .map((contact) => {
                  const isSent = sentNomors.includes(contact.nomor);
                  return (
                    <div key={contact.id} className={`${styles.contactRow} ${isSent ? styles.contactRowSent : ""}`}>
                      <div className={styles.contactInfo}>
                        <span className={styles.contactName}>{contact.nama}</span>
                        <span className={styles.contactNumber}>{contact.nomor}</span>
                      </div>
                      <div className={styles.rowActions}>
                        <button
                          className={isSent ? styles.sentBtn : styles.miniBtn}
                          onClick={() => handleSendSingleContact(contact)}
                          disabled={isSent}
                        >
                          {isSent ? "Terkirim" : "Kirim"}
                        </button>
                      </div>
                    </div>
                  );
                })}

              {isFetching && contacts.length === 0 && (
                <div className={styles.contactRow}>
                  <div className={styles.contactInfo}>
                    <span className={styles.contactName}>Memuat data...</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className={styles.card}>
          <div className={styles.egmsHeader}>
            <div className={styles.egmsTitleGroup}>
              <h3 className={styles.egmsTitle}>Event Guest Management System</h3>
              <p className={styles.egmsSubtitle}>
                Kelola daftar tamu, status undangan, dan pencarian tamu secara cepat.
              </p>
            </div>
          </div>

          <div className={styles.egmsStatsGrid}>
            <div className={styles.statCard}>
              <span className={styles.statLabel}>Tamu Terdata</span>
              <span className={styles.statValue}>{filteredGuestbook.length}</span>
            </div>
            <div className={styles.statCard}>
              <span className={styles.statLabel}>Terkirim</span>
              <span className={styles.statValue}>{filteredGuestbook.filter(c => c.is_sent && !c.is_present).length}</span>
            </div>
            <div className={styles.statCard}>
              <span className={styles.statLabel}>Hadir</span>
              <span className={styles.statValue}>{filteredGuestbook.filter(c => c.is_present).length}</span>
            </div>
          </div>

          <div className={styles.egmsControls}>
            <input
              id="guest-search"
              type="text"
              className={styles.searchField}
              placeholder="Cari nama atau nomor tamu..."
              value={guestbookQuery}
              onChange={(e) => setGuestbookQuery(e.target.value)}
            />
            <button className={styles.searchBtn} onClick={handleLoadContacts} disabled={isFetching}>
              {isFetching ? "..." : "Search"}
            </button>
          </div>

          <div className={styles.scanSection}>
            <button className={styles.btn} onClick={() => setIsScanning(true)} style={{ width: "100%", justifyContent: "center" }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18, marginRight: 8 }}>
                <path d="M3 7V5a2 2 0 0 1 2-2h2" />
                <path d="M17 3h2a2 2 0 0 1 2 2v2" />
                <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
                <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
                <rect x="7" y="7" width="10" height="10" rx="1" />
              </svg>
              Scan QR Tamu
            </button>
          </div>

          <div className={styles.egmsTable}>
            <div className={styles.egmsTableHead}>
              <span className={styles.egmsHeadCell} onClick={() => toggleSort('no')} style={{ cursor: 'pointer' }}>
                No {getSortIcon('no')}
              </span>
              <span className={styles.egmsHeadCell} onClick={() => toggleSort('nama')} style={{ cursor: 'pointer' }}>
                Nama Tamu {getSortIcon('nama')}
              </span>
              <span className={styles.egmsHeadCell} onClick={() => toggleSort('is_vip')} style={{ cursor: 'pointer' }}>
                Jenis {getSortIcon('is_vip')}
              </span>
              <span className={styles.egmsHeadCell} onClick={() => toggleSort('is_present')} style={{ cursor: 'pointer' }}>
                Status {getSortIcon('is_present')}
              </span>
              <span className={styles.egmsHeadCell}>Action</span>
            </div>

            {filteredGuestbook.length === 0 && !isFetching && (
              <div className={styles.egmsRowEmpty}>Belum ada tamu. Klik Search atau simpan data dari tab Send.</div>
            )}

            {filteredGuestbook.map((contact, index) => {
              const isSent = contact.is_sent || sentNomors.includes(contact.nomor);
              return (
                <div key={contact.id} className={styles.egmsRow}>
                  <span className={styles.egmsCell}>{index + 1}</span>
                  <div className={styles.egmsCellStrong}>
                    {contact.nama}
                  </div>
                  <div className={styles.egmsCell}>
                    {contact.is_vip && (
                      <span className={styles.vipBadge}>VIP</span>
                    )}
                  </div>
                  <div className={styles.egmsCell}>
                    {contact.is_present ? (
                      <span className={styles.statusHadir}>Hadir</span>
                    ) : isSent ? (
                      <span className={styles.statusSent}>Terkirim</span>
                    ) : (
                      <span className={styles.statusPending}>Belum</span>
                    )}
                  </div>
                  <div className={styles.egmsCell}>
                    <button 
                      className={styles.actionBtn}
                      onClick={() => setEditingContact(contact)}
                      title="Edit Tamu"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="var(--text-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16 }}>
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </button>
                  </div>
                </div>
              );
            })}

            {isFetching && filteredGuestbook.length === 0 && (
              <div className={styles.egmsRowEmpty}>Memuat data buku tamu...</div>
            )}
          </div>
        </div>
      )}

      <p className={styles.footerNote}>
        Kontak tersimpan, lalu pesan dikirim lewat WhatsApp dari browser.
      </p>

      {/* Modal Edit Tamu */}
      {editingContact && (
        <div className={styles.modalOverlay} onClick={() => setEditingContact(null)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>Edit Data Tamu</h3>
              <button className={styles.actionBtn} onClick={() => setEditingContact(null)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="var(--text-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 20, height: 20 }}>
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            
            <div className={styles.modalBody}>
              <div className={styles.field}>
                <label className={styles.label}>Nama Tamu</label>
                <div className={styles.modalInputRow}>
                  <input 
                    type="text" 
                    className={styles.input} 
                    value={editingContact.nama}
                    onChange={(e) => setEditingContact({ ...editingContact, nama: e.target.value })}
                    placeholder="Masukkan nama tamu"
                  />
                  <div className={styles.vipToggleMini}>
                    <span className={styles.vipLabelSmall}>VIP</span>
                    <label className={styles.switch}>
                      <input 
                        type="checkbox" 
                        checked={editingContact.is_vip}
                        onChange={(e) => setEditingContact({ ...editingContact, is_vip: e.target.checked })}
                      />
                      <span className={styles.slider}></span>
                    </label>
                  </div>
                </div>
              </div>

              <div className={styles.compactInfoCard}>
                <div className={styles.infoCol}>
                  <label className={styles.labelSmall}>Kehadiran</label>
                  <div className={styles.presenceControl}>
                    {editingContact.is_present ? (
                      <div className={styles.presentStatusInfo}>
                        <div className={styles.statusCheck}>✓</div>
                        <div>
                          <span className={styles.timeLabel}>HADIR</span>
                          <span className={styles.timeValue}>
                            {editingContact.present_at 
                              ? new Date(editingContact.present_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) 
                              : "-"}
                          </span>
                        </div>
                        <button className={styles.cancelLink} onClick={() => setEditingContact({...editingContact, is_present: false, present_at: null})}>
                          Batal
                        </button>
                      </div>
                    ) : (
                      <button className={styles.checkInBtn} onClick={() => setEditingContact({...editingContact, is_present: true, present_at: new Date().toISOString()})}>
                        Check-in
                      </button>
                    )}
                  </div>
                </div>

                <div className={styles.qrCol}>
                  <label className={styles.labelSmall}>QR Code</label>
                  <div className={styles.qrBoxCompact}>
                    <QRCodeSVG value={editingContact.token || "PENDING"} size={70} />
                  </div>
                </div>
              </div>
            </div>

            <div className={styles.modalFooterCompact}>
              <button className={styles.cancelBtn} onClick={() => setEditingContact(null)}>
                Batal
              </button>
              <button className={styles.saveBtn} onClick={() => handleUpdateContact(editingContact)}>
                Simpan
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Scanner Overlay */}
      {isScanning && (
        <ScannerOverlay 
          onScanSuccess={handleScanSuccess} 
          onClose={() => {
            setIsScanning(false);
            setScannedContact(null);
          }} 
          scannedContact={scannedContact}
          onReset={() => setScannedContact(null)}
        />
      )}
      {/* Notification Toast */}
      {feedback && (
        <div className={styles.toastSuccess}>
          <div className={styles.toastIcon}>✓</div>
          <div>{feedback}</div>
        </div>
      )}
      {errorMessage && (
        <div className={styles.toastError}>
          <div className={styles.toastIcon}>!</div>
          <div>{errorMessage}</div>
        </div>
      )}
    </>
  );
}

// Komponen Scanner Internal
function ScannerOverlay({ 
  onScanSuccess, 
  onClose,
  scannedContact,
  onReset
}: { 
  onScanSuccess: (text: string) => void; 
  onClose: () => void;
  scannedContact: Contact | null;
  onReset: () => void;
}) {
  useEffect(() => {
    if (scannedContact) return; // Stop scanner if showing result

    const html5QrCode = new Html5Qrcode("reader");
    const config = { fps: 15, qrbox: { width: 250, height: 250 } };

    html5QrCode.start(
      { facingMode: "environment" }, 
      config, 
      (decodedText) => {
        onScanSuccess(decodedText);
      },
      undefined
    ).catch(err => {
      console.error("Gagal menjalankan scanner:", err);
    });

    return () => {
      if (html5QrCode.isScanning) {
        html5QrCode.stop().catch(err => console.error(err));
      }
    };
  }, [onScanSuccess, scannedContact]);

  return (
    <div className={styles.modalOverlay}>
      <div className={styles.scannerCard}>
        <div className={styles.modalHeader}>
          <h3 className={styles.modalTitle}>
            {scannedContact ? "Konfirmasi Kehadiran" : "Scan QR Code Tamu"}
          </h3>
          <button className={styles.actionBtn} onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 20, height: 20 }}>
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {scannedContact ? (
          <div className={styles.scanResultCard}>
            <div className={styles.resultCheck}>✓</div>
            <h2 className={styles.resultName}>{scannedContact.nama}</h2>
            {scannedContact.is_vip && (
              <div className={styles.resultVip}>TAMU VIP</div>
            )}
            <div className={styles.resultInfo}>
              <span className={styles.resultLabel}>Waktu Hadir</span>
              <span className={styles.resultValue}>
                {scannedContact.present_at 
                  ? new Date(scannedContact.present_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) 
                  : "-"}
              </span>
            </div>
            <button className={styles.btn} onClick={onReset} style={{ width: "100%", marginTop: 24 }}>
              Terima Tamu Berikutnya
            </button>
          </div>
        ) : (
          <>
            <div id="reader" className={styles.reader}></div>
            <div className={styles.modalFooter}>
              <p className={styles.qrHint}>Arahkan kamera ke QR Code tamu</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
