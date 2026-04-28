"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
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

const getFinalLink = (rawLink: string, includeToken: boolean) => {
  let processed = rawLink.trim();
  if (!processed) return "";

  // Pastikan to={nama} ada (kecuali sudah ada to= atau {nama})
  if (!processed.includes("{nama}") && !processed.includes("to=")) {
    const separator = processed.includes("?") ? "&" : "?";
    processed = `${processed}${separator}to={nama}`;
  }

  // Pastikan token={id} ada jika diaktifkan (kecuali sudah ada token= atau {id})
  if (includeToken && !processed.includes("{id}") && !processed.includes("token=")) {
    const separator = processed.includes("?") ? "&" : "?";
    processed = `${processed}${separator}token={id}`;
  }

  return processed;
};

const buildMessage = (template: string, nama: string, link: string, id: string = "TOKEN") => {
  // Proses link terlebih dahulu untuk mengganti placeholder di dalamnya
  const finalizedLink = link
    .replace(/\{nama\}/g, encodeURIComponent(nama))
    .replace(/\{id\}/g, id);

  return template
    .replace(/\{nama\}/g, nama)
    .replace(/\{link\}/g, finalizedLink)
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

const initialLocal = (key: string, fallback: string = "") => {
  if (typeof window === "undefined") return fallback;
  return localStorage.getItem(key) ?? fallback;
};

export default function Home() {
  const [bulkInput, setBulkInput] = useState("");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [activeView, setActiveView] = useState<"send" | "guestbook" | "scan">("send");
  const [guestbookQuery, setGuestbookQuery] = useState("");
  const [sentNomors, setSentNomors] = useState<string[]>([]);
  const [isFetching, setIsFetching] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [scannedContact, setScannedContact] = useState<Contact | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [link, setLink] = useState(() => initialLocal("wa_sender_link", "https://nimantra.vercel.app/?to={nama}&token={id}"));
  const [pesan, setPesan] = useState(() => initialLocal("wa_sender_pesan", "Halo {nama}, kami mengundang Anda ke acara pernikahan kami. Detail undangan dapat dilihat pada link berikut: {link}"));
  const [feedback, setFeedback] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [includeToken, setIncludeToken] = useState(() => initialLocal("wa_sender_include_token", "true") === "true");
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [initialEditingContact, setInitialEditingContact] = useState<string | null>(null);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [deletingContact, setDeletingContact] = useState<Contact | null>(null);
  const [sortConfig, setSortConfig] = useState<{ key: keyof Contact | 'no'; direction: 'asc' | 'desc' }>({ key: 'is_present', direction: 'desc' });
  const [importOpen, setImportOpen] = useState(true);
  const [configOpen, setConfigOpen] = useState(true);

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

  const handleStartEdit = (contact: Contact) => {
    setEditingContact(contact);
    setInitialEditingContact(JSON.stringify(contact));
  };

  const handleCloseEdit = () => {
    if (!editingContact) {
      setEditingContact(null);
      setInitialEditingContact(null);
      return;
    }

    const isDirty = JSON.stringify(editingContact) !== initialEditingContact;

    if (isDirty) {
      setShowDiscardConfirm(true);
    } else {
      setEditingContact(null);
      setInitialEditingContact(null);
    }
  };

  const handleUpdateContact = async (updated: Contact, action?: "checkin") => {
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
          action,
          contacts: [{
            id: updated.id,
            nama: updated.nama,
            nomor: updated.nomor,
            is_vip: updated.is_vip,
            is_sent: updated.is_sent,
            is_present: updated.is_present,
            present_at: updated.present_at,
            token: updated.token
          }]
        }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Gagal memperbarui database.");
      }

      setFeedback("Perubahan berhasil disimpan.");
      setInitialEditingContact(null);
      setEditingContact(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Gagal menyimpan.";
      setErrorMessage(message);
      handleLoadContacts();
    }
  };

  const handleDeleteContact = async (id: number) => {
    if (!session) return;

    try {
      const response = await fetch(`/api/contacts?id=${id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Gagal menghapus.");
      }

      setFeedback("Tamu berhasil dihapus.");
      const deletedContact = contacts.find(c => c.id === id);
      if (deletedContact) {
        setSentNomors(prev => prev.filter(num => num !== deletedContact.nomor));
      }
      setContacts(prev => prev.filter(c => c.id !== id));
      setDeletingContact(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Gagal menghapus.");
    }
  };

  const playSound = (type: "success" | "vip" | "error") => {
    const sounds = {
      success: "/Success.wav",
      vip: "/Vip.wav",
      error: "/Error.wav"
    };
    const audio = new Audio(sounds[type]);
    audio.play().catch(() => { });
  };

  const handleScanSuccess = async (decodedText: string) => {
    const cleanToken = decodedText.trim();
    const contact = contacts.find(c => c.token === cleanToken);

    if (contact) {
      if (contact.is_present) {
        playSound("error");
        setErrorMessage(`GAGAL: ${contact.nama} sudah melakukan check-in sebelumnya!`);
      } else {
        playSound(contact.is_vip ? "vip" : "success");
        const now = new Date().toISOString();
        const updated = { ...contact, is_present: true, present_at: now };

        setFeedback(`BERHASIL: ${contact.nama} hadir!`);
        setScannedContact(updated);

        try {
          await handleUpdateContact(updated, "checkin");
        } catch (err) {
          setErrorMessage("Gagal menyimpan kehadiran.");
        }
      }
    } else {
      playSound("error");
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
      localStorage.setItem("wa_sender_pesan", pesan);
      localStorage.setItem("wa_sender_include_token", includeToken.toString());
    }
  }, [link, pesan, includeToken]);

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
      is_sent: true,
      token: c.token
    }));

    contacts.forEach((contact, index) => {
      const finalLink = getFinalLink(link, includeToken);
      const msg = buildMessage(pesan, contact.nama, finalLink, contact.token);
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

    const finalLink = getFinalLink(link, includeToken);
    const waUrl = `https://wa.me/${contact.nomor}?text=${encodeURIComponent(buildMessage(pesan, contact.nama, finalLink, contact.token))}`;
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
            is_sent: true,
            token: contact.token
          }]
        }),
      });
    }
  };

  const sentCount = contacts.filter(c => c.is_sent || sentNomors.includes(c.nomor)).length;

  const previewMessage = useMemo(() => {
    if (!pesan.trim()) return "";
    const namaPreview = contacts[0]?.nama ?? "Budi Santoso";

    const finalLinkPreview = getFinalLink(link || "https://nimantra.vercel.app/", includeToken);
    const idPreview = contacts[0]?.token ?? "ID123";
    return buildMessage(pesan, namaPreview, finalLinkPreview, idPreview);
  }, [contacts, link, pesan, includeToken]);

  const guestbookBaseList = useMemo(() => {
    // Hanya tamu yang sudah dikirim atau sudah hadir
    return contacts.filter(c => c.is_sent || c.is_present);
  }, [contacts]);

  const filteredGuestbook = useMemo(() => {
    const keyword = guestbookQuery.trim().toLowerCase();
    let processed = [...guestbookBaseList];

    // Tahap 2: Saring berdasarkan pencarian jika ada kata kunci
    if (keyword) {
      processed = processed.filter((contact) => {
        const byName = contact.nama.toLowerCase().includes(keyword);
        const byNumber = contact.nomor.toLowerCase().includes(keyword);
        return byName || byNumber;
      });
    }

    // Tahap 3: Pengurutan (Sorting)
    return processed.sort((a, b) => {
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
  }, [guestbookBaseList, guestbookQuery, sortConfig]);

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
      <div className={styles.loginWrapper}>
        <div className={styles.loginCard}>
          {/* Logo + Branding */}
          <div className={styles.loginBrand}>
            <div className={styles.loginLogo}>W</div>
            <h1 className={styles.loginTitle}>WA Sender</h1>
          </div>

          <div className={styles.loginDivider} />

          {/* Heading */}
          <div className={styles.loginHeading}>
            <h2 className={styles.loginH2}>Masuk ke Dashboard</h2>
            <p className={styles.loginDesc}>Masukkan kredensial untuk mengakses fitur pengiriman WhatsApp.</p>
          </div>

          {/* Form */}
          <form onSubmit={handleAuth} className={styles.loginForm}>
            <div className={styles.loginField}>
              <label htmlFor="username" className={styles.loginLabel}>Nama Pengantin</label>
              <div className={styles.loginInputWrap}>
                <svg className={styles.loginInputIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" /></svg>
                <input
                  id="username"
                  type="text"
                  className={styles.loginInput}
                  placeholder="Contoh: Fizah-Hanif"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  required
                />
              </div>
            </div>

            <div className={styles.loginField}>
              <label htmlFor="password" className={styles.loginLabel}>Password</label>
              <div className={styles.loginInputWrap}>
                <svg className={styles.loginInputIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="10" rx="2" /><path d="M7 11V8a5 5 0 0 1 10 0v3" /></svg>
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  className={styles.loginInput}
                  placeholder="Masukkan password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
                <button
                  type="button"
                  className={styles.loginEyeBtn}
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? "Sembunyikan" : "Tampilkan"}
                >
                  {showPassword ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                  )}
                </button>
              </div>
            </div>

            {loginError && <div className={styles.loginError}>{loginError}</div>}
            {feedback && <div className={styles.loginFeedback}>{feedback}</div>}

            <button className={styles.loginBtn} type="submit">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18 }}><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /><polyline points="10 17 15 12 10 7" /><line x1="15" y1="12" x2="3" y2="12" /></svg>
              Masuk
            </button>
          </form>

          <p className={styles.loginFooterText}>Akses terbatas hanya untuk pengguna terdaftar.</p>
        </div>
      </div>
    );
  }

  // This is the new dashboard return block
  const displayName = username || session.user.email?.split("@")[0] || "User";
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <div className={styles.dashboardShell}>
      {/* ─── Top Bar ─── */}
      <div className={styles.topBar}>
        <div className={styles.topBarBrand}>
          <div className={styles.topBarLogo}>W</div>
          <span className={styles.topBarTitle}>Dashboard</span>
        </div>
        <div className={styles.topBarUser}>
          <div className={styles.topBarAvatar}>{initial}</div>
          <span className={styles.topBarName}>{displayName}</span>
          <button className={styles.topBarLogout} onClick={handleLogout}>Logout</button>
        </div>
      </div>

      {/* ─── Body (sidebar + main) ─── */}
      <div className={styles.dashboardBody}>
        {/* Sidebar (desktop only) */}
        <nav className={styles.sidebar}>
          <button
            className={`${styles.sidebarItem} ${activeView === "send" ? styles.sidebarItemActive : ""}`}
            onClick={() => setActiveView("send")}
          >
            <span className={styles.sidebarIcon}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2L11 13" /><path d="M22 2l-7 20-4-9-9-4 20-7z" /></svg>
            </span>
            Kirim Pesan
          </button>
          <button
            className={`${styles.sidebarItem} ${activeView === "guestbook" ? styles.sidebarItemActive : ""}`}
            onClick={() => setActiveView("guestbook")}
          >
            <span className={styles.sidebarIcon}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
            </span>
            Buku Tamu
          </button>
          <button
            className={`${styles.sidebarItem} ${activeView === "scan" ? styles.sidebarItemActive : ""}`}
            onClick={() => setActiveView("scan")}
          >
            <span className={styles.sidebarIcon}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2" /><path d="M17 3h2a2 2 0 0 1 2 2v2" /><path d="M21 17v2a2 2 0 0 1-2 2h-2" /><path d="M7 21H5a2 2 0 0 1-2-2v-2" /><rect x="7" y="7" width="10" height="10" rx="1" /></svg>
            </span>
            Scan QR
          </button>
        </nav>

        {/* Main Content */}
        <main className={styles.mainContent}>
          <div className={styles.contentMaxWidth}>

            {activeView === "send" ? (
              <>
                <h2 className={styles.pageTitle}>Kirim Pesan Massal</h2>
                <p className={styles.pageSubtitle}>Kelola kontak dan kirim undangan WhatsApp secara massal.</p>

                {/* Stats Row */}
                <div className={styles.statsRow}>
                  <div className={styles.statItem}>
                    <div className={styles.statNumber}>{contacts.length}</div>
                    <div className={styles.statLabel2}>Kontak</div>
                  </div>
                  <div className={`${styles.statItem} ${styles.statAccent}`}>
                    <div className={styles.statNumber}>{sentCount}</div>
                    <div className={styles.statLabel2}>Terkirim</div>
                  </div>
                  <div className={`${styles.statItem} ${contacts.length - sentCount > 0 ? styles.statDanger : ""}`}>
                    <div className={styles.statNumber}>{contacts.length - sentCount}</div>
                    <div className={styles.statLabel2}>Belum</div>
                  </div>
                </div>

                {/* Panel: Import Contacts */}
                <div className={styles.panel}>
                  <div className={styles.panelHeader} onClick={() => setImportOpen(!importOpen)}>
                    <span className={styles.panelTitle}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16 }}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
                      Import Kontak
                    </span>
                    <span className={`${styles.panelToggle} ${importOpen ? styles.panelToggleOpen : ""}`}>▾</span>
                  </div>
                  <div className={importOpen ? styles.panelBody : styles.panelBodyHidden}>
                    <textarea
                      className={styles.textarea}
                      placeholder={"Budi Santoso, 08123456789\nSiti Aminah, +6281234567890"}
                      style={{ minHeight: "120px" }}
                      value={bulkInput}
                      onChange={(e) => setBulkInput(e.target.value)}
                    />
                    <div className={styles.hint}>Format: Nama, Nomor HP (satu baris per kontak).</div>
                    <button
                      className={styles.btn}
                      style={{ marginTop: "12px" }}
                      onClick={handleSaveContacts}
                      disabled={isSaving}
                    >
                      {isSaving ? "Menyimpan..." : "Simpan Kontak"}
                    </button>
                  </div>
                </div>

                {/* Panel: Message Config */}
                <div className={styles.panel}>
                  <div className={styles.panelHeader} onClick={() => setConfigOpen(!configOpen)}>
                    <span className={styles.panelTitle}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16 }}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                      Konfigurasi Pesan
                    </span>
                    <span className={`${styles.panelToggle} ${configOpen ? styles.panelToggleOpen : ""}`}>▾</span>
                  </div>
                  <div className={configOpen ? styles.panelBody : styles.panelBodyHidden}>
                    <div className={styles.field} style={{ marginBottom: "var(--space-2)" }}>
                      <div className={styles.toggleRow} style={{ background: "transparent", border: "none", padding: 0 }}>
                        <div className={styles.toggleLabel}>
                          <span className={styles.toggleTitle}>Lampirkan Token QR</span>
                          <span className={styles.toggleDesc}>Otomatis tambahkan token ke link</span>
                        </div>
                        <label className={styles.switch}>
                          <input
                            type="checkbox"
                            checked={includeToken}
                            onChange={(e) => setIncludeToken(e.target.checked)}
                          />
                          <span className={styles.slider}></span>
                        </label>
                      </div>
                    </div>

                    <div className={styles.field}>
                      <label htmlFor="link" className={styles.label}>Link / URL <span className={styles.req}>*</span></label>
                      <div className={styles.inputWrap}>
                        <input id="link" type="text" className={styles.input} placeholder="Contoh: https://link.com" autoComplete="off" value={link} onChange={(e) => setLink(e.target.value)} />
                        <span className={styles.inputIcon}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" /></svg>
                        </span>
                      </div>
                      {!link.trim() && <div className={styles.hintError}>Link tidak boleh kosong.</div>}
                    </div>

                    <div className={styles.field}>
                      <label htmlFor="pesan" className={styles.label}>Template Pesan <span className={styles.req}>*</span></label>
                      <div className={styles.inputWrap}>
                        <textarea id="pesan" className={styles.textarea} placeholder={"Halo {nama}, ini link undangan Anda: {link}"} value={pesan} onChange={(e) => setPesan(e.target.value)} />
                        <span className={`${styles.inputIcon} ${styles.inputIconTextarea}`}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /></svg>
                        </span>
                      </div>
                      <div className={styles.hint}>Gunakan <strong>{"{nama}"}</strong>, <strong>{"{link}"}</strong>.</div>
                      {!pesan.trim() && <div className={styles.hintError}>Template pesan tidak boleh kosong.</div>}
                      {pesanMissingNama && <div className={styles.hintError}>Template harus mengandung <strong>{"{nama}"}</strong></div>}
                      {pesanMissingLink && <div className={styles.hintError}>Template harus mengandung <strong>{"{link}"}</strong></div>}
                    </div>

                    {previewMessage && (
                      <div className={styles.previewSection}>
                        <div className={styles.previewLabel}>Pratinjau Pesan</div>
                        <div className={styles.previewBox}>{previewMessage}</div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Panel: Contact List */}
                <div className={styles.panel}>
                  <div className={styles.panelHeader}>
                    <span className={styles.panelTitle}>Daftar Kontak ({contacts.length})</span>
                    <span className={styles.bulkStats}>{sentCount} / {contacts.length} Terkirim</span>
                  </div>
                  <div className={styles.panelBody} style={{ paddingTop: 0 }}>
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

              </>
            ) : activeView === "guestbook" ? (
              <>
                <h2 className={styles.pageTitle}>Buku Tamu</h2>
                <p className={styles.pageSubtitle}>Kelola daftar tamu, status undangan, dan pencarian tamu.</p>

                {/* Stats Row */}
                <div className={styles.statsRow}>
                  <div className={styles.statItem}>
                    <div className={styles.statNumber}>{guestbookBaseList.length}</div>
                    <div className={styles.statLabel2}>Tamu</div>
                  </div>
                  <div className={`${styles.statItem} ${styles.statAccent}`}>
                    <div className={styles.statNumber}>{guestbookBaseList.filter(c => c.is_sent && !c.is_present).length}</div>
                    <div className={styles.statLabel2}>Pending</div>
                  </div>
                  <div className={`${styles.statItem} ${styles.statAccent}`}>
                    <div className={styles.statNumber}>{guestbookBaseList.filter(c => c.is_present).length}</div>
                    <div className={styles.statLabel2}>Hadir</div>
                  </div>
                </div>

                {/* Search + Scan */}
                <div className={styles.panel}>
                  <div className={styles.panelBody} style={{ paddingTop: "var(--space-2)" }}>
                    <div className={styles.egmsControls}>
                      <input
                        id="guest-search"
                        type="text"
                        className={styles.searchField}
                        placeholder="Cari nama atau nomor tamu..."
                        value={guestbookQuery}
                        onChange={(e) => setGuestbookQuery(e.target.value)}
                      />
                    </div>
                  </div>
                </div>

                {/* Guest Table */}
                <div className={styles.panel}>
                  <div className={styles.egmsTable}>
                    <div className={styles.egmsTableHead}>
                      <span className={styles.egmsHeadCell} onClick={() => toggleSort('no')} style={{ cursor: 'pointer' }}>No {getSortIcon('no')}</span>
                      <span className={styles.egmsHeadCell} onClick={() => toggleSort('nama')} style={{ cursor: 'pointer' }}>Nama Tamu {getSortIcon('nama')}</span>
                      <span className={styles.egmsHeadCell} onClick={() => toggleSort('is_vip')} style={{ cursor: 'pointer' }}>Jenis {getSortIcon('is_vip')}</span>
                      <span className={styles.egmsHeadCell} onClick={() => toggleSort('is_present')} style={{ cursor: 'pointer' }}>Status {getSortIcon('is_present')}</span>
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
                          <div className={styles.egmsCellStrong}>{contact.nama}</div>
                          <div className={styles.egmsCell}>{contact.is_vip && <span className={styles.vipBadge}>VIP</span>}</div>
                          <div className={styles.egmsCell}>
                            {contact.is_present ? <span className={styles.statusHadir}>Hadir</span> : isSent ? <span className={styles.statusSent}>Terkirim</span> : <span className={styles.statusPending}>Belum</span>}
                          </div>
                          <div className={styles.actionCell}>
                            <button className={styles.actionBtn} onClick={() => handleStartEdit(contact)} title="Edit Tamu">
                              <svg viewBox="0 0 24 24" fill="none" stroke="var(--text-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16 }}>
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                              </svg>
                            </button>
                            <button className={styles.actionBtn} onClick={() => setDeletingContact(contact)} title="Hapus Tamu" style={{ color: "var(--danger)" }}>
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16 }}>
                                <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" />
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
              </>
            ) : (
              <ScannerView
                onScanSuccess={handleScanSuccess}
                scannedContact={scannedContact}
                onReset={() => setScannedContact(null)}
              />
            )}
          </div>
        </main>
      </div>

      {/* ─── Bottom Navigation (mobile only) ─── */}
      <nav className={styles.bottomNav}>
        <button className={`${styles.bottomNavItem} ${activeView === "send" ? styles.bottomNavItemActive : ""}`} onClick={() => setActiveView("send")}>
          <span className={styles.bottomNavIcon}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2L11 13" /><path d="M22 2l-7 20-4-9-9-4 20-7z" /></svg>
          </span>
          Kirim
        </button>
        <button className={`${styles.bottomNavItem} ${activeView === "guestbook" ? styles.bottomNavItemActive : ""}`} onClick={() => setActiveView("guestbook")}>
          <span className={styles.bottomNavIcon}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
          </span>
          Buku Tamu
        </button>
        <button className={`${styles.bottomNavItem} ${activeView === "scan" ? styles.bottomNavItemActive : ""}`} onClick={() => setActiveView("scan")}>
          <span className={styles.bottomNavIcon}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2" /><path d="M17 3h2a2 2 0 0 1 2 2v2" /><path d="M21 17v2a2 2 0 0 1-2 2h-2" /><path d="M7 21H5a2 2 0 0 1-2-2v-2" /><rect x="7" y="7" width="10" height="10" rx="1" /></svg>
          </span>
          Scan QR
        </button>
      </nav>

      {/* ─── Edit Guest Modal ─── */}
      {editingContact && (
        <div className={styles.modalOverlay} onClick={handleCloseEdit}>
          <div className={styles.editModal} onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className={styles.editModalHead}>
              <h3 className={styles.editModalTitle}>Edit Tamu</h3>
              <button className={styles.editModalClose} onClick={handleCloseEdit}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>

            {/* Body */}
            <div className={styles.editModalBody}>
              {/* Name field */}
              <div className={styles.editField}>
                <label className={styles.editLabel}>Nama Tamu</label>
                <input
                  type="text"
                  className={styles.editInput}
                  value={editingContact.nama}
                  onChange={(e) => setEditingContact({ ...editingContact, nama: e.target.value })}
                  placeholder="Masukkan nama tamu"
                />
              </div>

              {/* VIP Toggle Row */}
              <div className={styles.editToggleRow}>
                <div className={styles.editToggleInfo}>
                  <span className={styles.editToggleTitle}>Tamu VIP</span>
                  <span className={styles.editToggleDesc}>Tandai sebagai tamu prioritas</span>
                </div>
                <label className={styles.switch}>
                  <input type="checkbox" checked={editingContact.is_vip} onChange={(e) => setEditingContact({ ...editingContact, is_vip: e.target.checked })} />
                  <span className={styles.slider}></span>
                </label>
              </div>

              {/* Attendance Status */}
              <div className={styles.editField}>
                <label className={styles.editLabel}>Status Kehadiran</label>
                {editingContact.is_present ? (
                  <div className={styles.editStatusPresent}>
                    <div className={styles.editStatusIcon}>✓</div>
                    <div className={styles.editStatusInfo}>
                      <span className={styles.editStatusTitle}>Sudah Hadir</span>
                      <span className={styles.editStatusTime}>
                        {editingContact.present_at
                          ? new Date(editingContact.present_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })
                          : "-"}
                      </span>
                    </div>
                    <button className={styles.editStatusUndo} onClick={() => setEditingContact({ ...editingContact, is_present: false, present_at: null })}>
                      Batalkan
                    </button>
                  </div>
                ) : (
                  <button className={styles.editCheckInBtn} onClick={() => setEditingContact({ ...editingContact, is_present: true, present_at: new Date().toISOString() })}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16 }}><polyline points="20 6 9 17 4 12" /></svg>
                    Check-in Sekarang
                  </button>
                )}
              </div>

              {/* QR Code */}
              <div className={styles.editField}>
                <label className={styles.editLabel}>QR Code</label>
                <div className={styles.editQrBox}>
                  <QRCodeSVG value={editingContact.token || "PENDING"} size={100} />
                  <span className={styles.editQrToken}>{editingContact.token || "—"}</span>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className={styles.editModalFoot}>
              <button className={styles.editCancelBtn} onClick={handleCloseEdit}>Batal</button>
              <button className={styles.editSaveBtn} onClick={() => handleUpdateContact(editingContact)}>Simpan Perubahan</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Delete Confirmation Modal ─── */}
      {deletingContact && (
        <div className={styles.modalOverlay} onClick={() => setDeletingContact(null)}>
          <div className={styles.editModal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.editModalHead}>
              <h3 className={styles.editModalTitle}>Hapus Tamu</h3>
              <button className={styles.editModalClose} onClick={() => setDeletingContact(null)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>

            <div className={styles.editModalBody}>
              <div style={{ textAlign: "center", padding: "20px 0" }}>
                <div style={{
                  width: "60px",
                  height: "60px",
                  background: "rgba(239, 68, 68, 0.1)",
                  color: "#ef4444",
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  margin: "0 auto 16px",
                  fontSize: "24px",
                  fontWeight: 800
                }}>
                  !
                </div>
                <p style={{ fontSize: "16px", fontWeight: 700, color: "var(--text-primary)", marginBottom: "8px" }}>
                  Hapus "{deletingContact.nama}"?
                </p>
                <p style={{ fontSize: "14px", color: "var(--text-hint)", lineHeight: 1.5 }}>
                  Tindakan ini tidak dapat dibatalkan. Tamu ini akan dihapus permanen dari daftar.
                </p>
              </div>
            </div>

            <div className={styles.editModalFoot}>
              <button className={styles.editCancelBtn} onClick={() => setDeletingContact(null)}>Batal</button>
              <button
                className={styles.editSaveBtn}
                style={{ background: "#ef4444", boxShadow: "0 4px 12px rgba(239, 68, 68, 0.25)" }}
                onClick={() => handleDeleteContact(deletingContact.id)}
              >
                Hapus Sekarang
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Discard Changes Confirmation Modal ─── */}
      {showDiscardConfirm && (
        <div className={styles.modalOverlay} style={{ zIndex: 3000 }} onClick={() => setShowDiscardConfirm(false)}>
          <div className={styles.editModal} style={{ maxWidth: "380px" }} onClick={(e) => e.stopPropagation()}>
            <div className={styles.editModalHead}>
              <h3 className={styles.editModalTitle}>Perubahan Belum Disimpan</h3>
              <button className={styles.editModalClose} onClick={() => setShowDiscardConfirm(false)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            
            <div className={styles.editModalBody}>
              <div style={{ textAlign: "center", padding: "10px 0" }}>
                <p style={{ fontSize: "15px", color: "var(--text-primary)", lineHeight: 1.5 }}>
                  Anda memiliki perubahan yang belum disimpan. Yakin ingin membatalkan?
                </p>
              </div>
            </div>

            <div className={styles.editModalFoot}>
              <button className={styles.editCancelBtn} onClick={() => setShowDiscardConfirm(false)}>Lanjut Edit</button>
              <button 
                className={styles.editSaveBtn} 
                style={{ background: "#f59e0b", boxShadow: "0 4px 12px rgba(245, 158, 11, 0.25)" }}
                onClick={() => {
                  setEditingContact(null);
                  setInitialEditingContact(null);
                  setShowDiscardConfirm(false);
                }}
              >
                Buang Perubahan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Toast Notifications */}
      {feedback && (
        <div key={`fb-${feedback}`} className={styles.toastSuccess}>
          <div className={styles.toastIcon}>✓</div>
          <span>{feedback}</span>
        </div>
      )}
      {errorMessage && (
        <div key={`err-${errorMessage}`} className={styles.toastError}>
          <div className={styles.toastIcon}>!</div>
          <span>{errorMessage}</span>
        </div>
      )}
    </div>
  );

}

// Komponen Scanner Internal (Didedikasikan sebagai View)
function ScannerView({
  onScanSuccess,
  scannedContact,
  onReset
}: {
  onScanSuccess: (text: string) => void;
  scannedContact: Contact | null;
  onReset: () => void;
}) {
  const scannerRef = useRef<any>(null);
  const onScanSuccessRef = useRef(onScanSuccess);
  onScanSuccessRef.current = onScanSuccess;
  const [facingMode, setFacingMode] = useState<"user" | "environment">("environment");

  const toggleCamera = () => {
    setFacingMode(prev => (prev === "environment" ? "user" : "environment"));
    // Restart scanner logic will handle the change because facingMode is in dependency array
  };

  useEffect(() => {
    if (scannedContact) return;

    let cancelled = false;
    const startDelay = setTimeout(() => {
      if (cancelled) return;

      const html5QrCode = new Html5Qrcode("reader");
      scannerRef.current = html5QrCode;
      const config = {
        fps: 20,
        qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
          const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
          const size = Math.floor(minEdge * 0.65);
          return { width: size, height: size };
        },
        aspectRatio: 1.0
      };

      html5QrCode.start(
        { facingMode: facingMode },
        config,
        (decodedText) => {
          onScanSuccessRef.current(decodedText);
        },
        undefined
      ).catch(() => { });
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(startDelay);
      const scanner = scannerRef.current;
      if (scanner) {
        try {
          if (scanner.getState && scanner.getState() !== 1) {
            scanner.stop().then(() => scanner.clear()).catch(() => { });
          }
        } catch { }
      }
      scannerRef.current = null;
    };
  }, [scannedContact, facingMode]);

  // Auto-dismiss after scan: 1s for regular, 3s for VIP
  useEffect(() => {
    if (!scannedContact) return;
    const delay = scannedContact.is_vip ? 3000 : 1000;
    const timer = setTimeout(() => {
      onReset();
    }, delay);
    return () => clearTimeout(timer);
  }, [scannedContact, onReset]);

  return (
    <div className={styles.scannerView}>
      <h2 className={styles.pageTitle}>
        {scannedContact ? "Konfirmasi Kehadiran" : "Scan QR Code Tamu"}
      </h2>
      <p className={styles.pageSubtitle}>
        {scannedContact ? "Tamu berhasil dipindai." : "Arahkan kamera ke QR Code tamu untuk check-in."}
      </p>

      <div className={styles.scannerContainer}>
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
          <div className={styles.readerWrapper}>
            <button
              className={styles.cameraToggle}
              onClick={toggleCamera}
              title="Ganti Kamera"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
            </button>
            <div
              id="reader"
              className={`${styles.reader} ${facingMode === "user" ? styles.readerMirrored : ""}`}
            ></div>
            <div className={styles.scannerOverlayFrame}>
              <div className={styles.scannerFrameCorners}></div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
