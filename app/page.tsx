"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import { QRCodeSVG } from "qrcode.react";
import { Html5Qrcode } from "html5-qrcode";
import styles from "./page.module.css";
import { supabase } from "@/lib/supabase";
import { type Session } from "@supabase/supabase-js";
import type { Role } from "@/lib/rbac/types";

type Contact = {
  id: number;
  nama: string;
  nomor: string;
  created_at: string;
  priority: string;
  kategori: string;
  is_sent: boolean;
  is_present: boolean;
  present_at: string | null;
  token: string;
  added_via?: "manual" | "bulk";
};


type SaveResponse = {
  savedCount: number;
  contacts: Contact[];
};

type SessionInfo = {
  role: Role;
  tenantId?: string | null;
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
  const validContacts: { nama: string; nomor: string; priority: string; kategori: string; added_via: "bulk" }[] = [];
  const invalidLines: string[] = [];
  let counter = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const parts = line.split(/[,\t;]/);
    const nama = parts[0]?.trim() ?? "";
    let nomor = parts.length >= 2 ? sanitizeNomor(parts[1]?.trim() ?? "") : "";

    if (!nama) {
      invalidLines.push(rawLine);
      continue;
    }

    // Jika nomor kosong, generate unique ID (Timestamp + Counter + Random)
    if (!nomor) {
      const ts = Date.now().toString().slice(-8);
      const rand = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
      nomor = `99${ts}${counter++}${rand}`;
    }

    validContacts.push({ nama, nomor, priority: "Reguler", kategori: "-", added_via: "bulk" });
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

// Helper untuk mendapatkan warna kategori berdasarkan nama (hashing)
const getCategoryColor = (category: string) => {
  if (!category || category === "-") return { bg: "#f3f4f6", text: "#4b5563" };

  const colors = [
    { bg: "#e0f2fe", text: "#0369a1" }, // Blue
    { bg: "#dcfce7", text: "#15803d" }, // Green
    { bg: "#fef3c7", text: "#b45309" }, // Amber
    { bg: "#f3e8ff", text: "#7e22ce" }, // Purple
    { bg: "#fee2e2", text: "#b91c1c" }, // Red
    { bg: "#e0e7ff", text: "#4338ca" }, // Indigo
    { bg: "#fae8ff", text: "#a21caf" }, // Pink
    { bg: "#f0fdf4", text: "#166534" }, // Emerald
    { bg: "#fff7ed", text: "#c2410c" }, // Orange
    { bg: "#ecfeff", text: "#0e7490" }, // Cyan
  ];

  let hash = 0;
  for (let i = 0; i < category.length; i++) {
    hash = category.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % colors.length;
  return colors[index];
};

export default function Home() {
  const router = useRouter();
  const [bulkInput, setBulkInput] = useState("");
  const [contacts, setContacts] = useState<Contact[]>(() => {
    if (typeof window === "undefined") return [];
    const cached = localStorage.getItem("wa_sender_contacts");
    return cached ? JSON.parse(cached) : [];
  });
  const [activeView, setActiveView] = useState<"dashboard" | "send" | "guestbook" | "scan">(() => initialLocal("wa_sender_active_view", "dashboard") as any);
  const [guestbookQuery, setGuestbookQuery] = useState("");
  const [sentNomors, setSentNomors] = useState<string[]>([]);
  const [isFetching, setIsFetching] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [scannedContact, setScannedContact] = useState<Contact | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [link, setLink] = useState("https://nimantra.vercel.app/?to={nama}&token={id}");
  const [pesan, setPesan] = useState("Halo {nama}, kami mengundang Anda ke acara pernikahan kami. Detail undangan dapat dilihat pada link berikut: {link}");
  const [feedback, setFeedback] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(() => {
    if (typeof window === "undefined") return null;
    const cached = localStorage.getItem("wa_sender_session_info");
    return cached ? JSON.parse(cached) : null;
  });
  const sessionFetchedRef = useRef<string | null>(null);
  const [isRoleChecking, setIsRoleChecking] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [includeToken, setIncludeToken] = useState(true);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [isAddingGuest, setIsAddingGuest] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [activityPage, setActivityPage] = useState(1);
  const [activityRowsPerPage, setActivityRowsPerPage] = useState(5);
  const [newGuestData, setNewGuestData] = useState({ nama: "", nomor: "", priority: "Reguler", kategori: "-" });
  const [isAddingNewCategory, setIsAddingNewCategory] = useState(false);
  const [newCategoryValue, setNewCategoryValue] = useState("");
  const [importCategory, setImportCategory] = useState("-");
  const [importPriority, setImportPriority] = useState("Reguler");
  const [isAddingNewCategoryImport, setIsAddingNewCategoryImport] = useState(false);
  const [newCategoryValueImport, setNewCategoryValueImport] = useState("");
  const [tempImportCategory, setTempImportCategory] = useState<string | null>(null);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [initialEditingContact, setInitialEditingContact] = useState<string | null>(null);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [deletingContact, setDeletingContact] = useState<Contact | null>(null);
  const [sortConfig, setSortConfig] = useState<{ key: keyof Contact | 'no'; direction: 'asc' | 'desc' }>({ key: 'is_present', direction: 'desc' });
  const [importOpen, setImportOpen] = useState(true);
  const [configOpen, setConfigOpen] = useState(true);
  const [isSidebarMinimized, setIsSidebarMinimized] = useState(() => initialLocal("wa_sender_sidebar_minimized", "false") === "true");
  const channelRef = useRef<any>(null);

  const actualUsername = session?.user?.email?.split('@')[0] || 'tamu';
  const computedLink = `https://nimantra.vercel.app/${actualUsername}/`;

  useEffect(() => {
    localStorage.setItem("wa_sender_sidebar_minimized", isSidebarMinimized.toString());
  }, [isSidebarMinimized]);

  // Helper to map username to internal email for Supabase Auth
  const getInternalEmail = (user: string) => `${user.trim().toLowerCase()}@wedding.com`;

  const [copied, setCopied] = useState(false);
  const pesanMissingNama = pesan.trim() !== "" && !pesan.includes("{nama}");
  const pesanMissingLink = pesan.trim() !== "" && !pesan.includes("{link}");
  const templateInvalid = !pesan.trim() || !computedLink.trim() || pesanMissingNama || pesanMissingLink;

  // Efek untuk membersihkan notifikasi otomatis setelah 3 detik
  useEffect(() => {
    if (feedback || errorMessage || loadingMessage) {
      const timer = setTimeout(() => {
        setFeedback("");
        setErrorMessage("");
        setLoadingMessage("");
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
            priority: updated.priority,
            kategori: updated.kategori,
            is_sent: updated.is_sent,
            is_present: updated.is_present,
            present_at: updated.present_at,
            token: updated.token,
            added_via: updated.added_via
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

      // Broadcast sync
      if (channelRef.current) {
        channelRef.current.send({
          type: "broadcast",
          event: "sync-data",
          payload: { type: "CONTACTS_UPDATED", sender: session?.user?.id }
        });
      }
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

      // Broadcast sync
      if (channelRef.current) {
        channelRef.current.send({
          type: "broadcast",
          event: "sync-data",
          payload: { type: "CONTACTS_UPDATED", sender: session?.user?.id }
        });
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Gagal menghapus.");
    }
  };

  const handleAddGuest = async () => {
    if (!session) return;
    if (!newGuestData.nama) {
      alert("Nama wajib diisi!");
      return;
    }

    setIsSaving(true);
    try {
      // Jika nomor kosong, generate unique ID berbasis timestamp
      const finalNomor = newGuestData.nomor || `99${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;

      const response = await fetch("/api/contacts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          contacts: [{
            nama: newGuestData.nama,
            nomor: finalNomor,
            priority: "Reguler",
            kategori: "Manual",
            added_via: "manual",
            is_sent: true,
            is_present: true,
            present_at: new Date().toISOString()
          }]
        }),
      });

      if (!response.ok) throw new Error("Gagal menyimpan tamu");

      const result = await response.json();
      setContacts(result.contacts);
      setIsAddingGuest(false);
      setNewGuestData({ nama: "", nomor: "", priority: "Reguler", kategori: "-" });
      setFeedback("Tamu berhasil ditambahkan!");

      // Broadcast sync ke perangkat lain
      if (channelRef.current) {
        channelRef.current.send({
          type: "broadcast",
          event: "sync-data",
          payload: { type: "CONTACTS_UPDATED", sender: session?.user?.id }
        });
      }
    } catch (err) {
      console.error(err);
      setErrorMessage("Gagal menambahkan tamu.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleCopyPreview = () => {
    if (!previewMessage) return;
    navigator.clipboard.writeText(previewMessage);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
        const isVip = contact.priority?.toUpperCase() === "VIP" || contact.priority?.toUpperCase() === "VVIP";
        playSound(isVip ? "vip" : "success");
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
  const handleLoadContacts = async (force: boolean = false) => {
    if (!session) return;

    try {
      console.log("[DEBUG] Fetching contacts (force=" + force + ")...");
      if (contacts.length === 0) setIsFetching(true);

      const response = await fetch("/api/contacts", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: "no-store"
      });
      const data = await response.json();
      if (response.ok) {
        const freshContacts = Array.isArray(data.contacts) ? data.contacts : [];
        setContacts(freshContacts);
        setSentNomors(freshContacts.filter((c: Contact) => c.is_sent).map((c: Contact) => c.nomor));

        // Simpan ke localStorage di latar belakang (non-blocking)
        setTimeout(() => {
          localStorage.setItem("wa_sender_contacts", JSON.stringify(freshContacts));
          localStorage.setItem("wa_sender_contacts_last_fetched", Date.now().toString());
        }, 0);
      }
    } catch (err) {
      console.error("Load Error:", err);
    } finally {
      setIsFetching(false);
    }
  };

  const handleLoadSettings = async () => {
    if (!session) return;
    try {
      const response = await fetch("/api/settings", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await response.json();
      if (response.ok && data.settings) {
        setLink(data.settings.link);
        setPesan(data.settings.pesan);
        setIncludeToken(data.settings.include_token);
      }
    } catch (err) {
      console.error("Load Settings Error:", err);
    }
  };

  const handleUpdateSettings = async (updates: { link?: string; pesan?: string; include_token?: boolean }) => {
    if (!session) return;

    // Optimistic update
    if (updates.link !== undefined) setLink(updates.link);
    if (updates.pesan !== undefined) setPesan(updates.pesan);
    if (updates.include_token !== undefined) setIncludeToken(updates.include_token);

    try {
      await fetch("/api/settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          link: updates.link ?? link,
          pesan: updates.pesan ?? pesan,
          include_token: updates.include_token ?? includeToken,
        }),
      });
    } catch (err) {
      console.error("Update Settings Error:", err);
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
    let active = true;

    if (!session) {
      if (!isInitializing) {
        setSessionInfo(null);
        setIsRoleChecking(false);
        sessionFetchedRef.current = null;
        localStorage.removeItem("wa_sender_session_info");
        localStorage.removeItem("wa_sender_contacts");
      }
      return;
    }

    // Jika sudah pernah fetch untuk session ini, lewatkan
    if (sessionFetchedRef.current === session.access_token) {
      setIsRoleChecking(false);
      return;
    }

    // Segera kunci agar tidak ada fetch paralel
    sessionFetchedRef.current = session.access_token;

    const loadSessionInfo = async () => {
      setIsRoleChecking(true);
      try {
        if (!session?.access_token) {
          throw new Error("No access token in session");
        }

        const response = await fetch("/api/me", {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        });

        if (!response.ok) {
          throw new Error("Unauthorized");
        }

        const data = (await response.json()) as SessionInfo;

        if (!active) return;

        const info = { role: data.role, tenantId: data.tenantId ?? null };
        setSessionInfo(info);
        localStorage.setItem("wa_sender_session_info", JSON.stringify(info));

        if (data.role === "admin") {
          router.replace("/admin");
          return;
        }

        if (data.role === "superadmin") {
          router.replace("/superadmin");
        }
      } catch {
        if (active) {
          setSessionInfo(null);
        }
      } finally {
        if (active) {
          setIsRoleChecking(false);
        }
      }
    };

    loadSessionInfo();

    return () => {
      active = false;
    };
  }, [session, router, sessionInfo]);

  useEffect(() => {
    if (!session) {
      setContacts([]);
      return;
    }

    if (!sessionInfo) {
      return;
    }

    // Ambil data awal
    console.log("[DEBUG] Session & SessionInfo ready, loading initial data");
    handleLoadContacts();
    handleLoadSettings();

    const tenantFilter = sessionInfo.tenantId
      ? `tenant_id=eq.${sessionInfo.tenantId}`
      : `user_id=eq.${session?.user?.id}`;

    // Pasang pendengar Realtime terpadu
    const channelId = `sync:${sessionInfo.tenantId ?? session?.user?.id}`;
    const channel = supabase
      .channel(channelId)
    channelRef.current = channel;
    
    channel
      // 1. Listen for Broadcast events (Instant)
      .on(
        "broadcast",
        { event: "sync-data" },
        (payload) => {
          console.log("[DEBUG] Broadcast received:", payload.payload.type);
          const { type, sender } = payload.payload;

          // Abaikan jika pengirim adalah diri sendiri (opsional)
          if (sender === session?.user?.id) return;

          if (type === "CONTACTS_UPDATED") {
            handleLoadContacts(true);
          } else if (type === "SETTINGS_UPDATED") {
            handleLoadSettings();
          }
        }
      )
      // 2. Listen for Database changes (Reliable backup)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "contacts",
          filter: tenantFilter
        },
        (payload) => {
          console.log("[DEBUG] Postgres contact change:", payload.eventType);
          if (payload.eventType === "UPDATE" && payload.new) {
            const updatedContact = payload.new as Contact;
            setContacts(prev => prev.map(c => c.id === updatedContact.id ? { ...c, ...updatedContact } : c));
          } else if (payload.eventType === "INSERT" && payload.new) {
            const newContact = payload.new as Contact;
            setContacts(prev => {
              if (prev.some(c => c.id === newContact.id)) return prev;
              return [newContact, ...prev];
            });
          } else if (payload.eventType === "DELETE" && payload.old) {
            const oldId = payload.old.id;
            setContacts(prev => prev.filter(c => c.id !== oldId));
          } else {
            handleLoadContacts(true);
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "settings",
          filter: tenantFilter
        },
        () => {
          console.log("[DEBUG] Postgres settings change detected");
          handleLoadSettings();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [session, sessionInfo]);

  // 3. Local Storage Sync
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("wa_sender_link", link);
      localStorage.setItem("wa_sender_pesan", pesan);
      localStorage.setItem("wa_sender_include_token", includeToken.toString());
      localStorage.setItem("wa_sender_active_view", activeView);
      localStorage.setItem("wa_sender_contacts", JSON.stringify(contacts));
    }
  }, [link, pesan, includeToken, activeView, contacts]);

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

      // Ambil nilai kategori terbaru dengan lebih tegas
      let finalCategory = "-";
      if (isAddingNewCategoryImport) {
        finalCategory = newCategoryValueImport.trim() || "-";
      } else {
        finalCategory = importCategory;
      }

      // Beri tahu user kategori apa yang sedang diproses agar bisa kita lacak
      const readableCategory = finalCategory === "-" ? "Tanpa Kategori" : finalCategory;
      setLoadingMessage(`Sedang menyimpan ${validContacts.length} kontak ke kategori: ${readableCategory}...`);

      const payloadContacts = validContacts.map(c => {
        return {
          nama: c.nama,
          nomor: c.nomor,
          priority: "Reguler", // Default reguler karena UI priority dihapus
          kategori: finalCategory,
          added_via: "bulk" as const
        };
      });

      const response = await fetch("/api/contacts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ contacts: payloadContacts }),
      });

      setLoadingMessage("");
      const data = (await response.json()) as { contacts?: Contact[], savedCount?: number, error?: string };

      if (!response.ok) {
        throw new Error(data.error || "Gagal menyimpan kontak.");
      }

      // Pastikan kita mengambil data terbaru dari database
      const savedCount = Number(data.savedCount ?? 0);
      const savedContacts = Array.isArray(data.contacts) ? data.contacts : [];
      setContacts(savedContacts);

      setSentNomors([]);
      setBulkInput("");

      // Reset status kategori setelah berhasil
      setIsAddingNewCategoryImport(false);
      setNewCategoryValueImport("");
      setTempImportCategory(null);
      setImportCategory("-");

      // Broadcast sync
      if (channelRef.current) {
        channelRef.current.send({
          type: "broadcast",
          event: "sync-data",
          payload: { type: "CONTACTS_UPDATED", sender: session?.user?.id }
        });
      }

      if (invalidLines.length > 0) {
        setFeedback(
          `Berhasil simpan ${savedCount} kontak. ${invalidLines.length} baris diabaikan karena format tidak valid.`
        );
      } else {
        setFeedback(`Berhasil simpan ${savedCount} kontak.`);
      }
    } catch (error) {
      setLoadingMessage("");
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

    try {
      setIsSending(true);
      const finalLink = getFinalLink(computedLink, includeToken);

      const sentUpdates = contacts.map(c => ({
        id: c.id,
        nama: c.nama,
        nomor: c.nomor,
        priority: c.priority,
        kategori: c.kategori,
        is_sent: true,
        token: c.token,
        added_via: c.added_via
      }));

      contacts.forEach((contact, index) => {
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

      // Broadcast sync
      if (channelRef.current) {
        channelRef.current.send({
          type: "broadcast",
          event: "sync-data",
          payload: { type: "CONTACTS_UPDATED", sender: session?.user?.id }
        });
      }

      setFeedback(`Membuka ${contacts.length} chat WhatsApp. Pastikan browser mengizinkan pop-up.`);
      setTimeout(() => setIsSending(false), contacts.length * 220 + 300);
    } catch (err) {
      setErrorMessage("Gagal memproses pengiriman massal.");
      setIsSending(false);
    }
  };

  const handleMarkAsSent = (contact: Contact) => {
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
            priority: contact.priority,
            kategori: contact.kategori,
            is_sent: true,
            token: contact.token,
            added_via: contact.added_via
          }]
        }),
      });

      // Broadcast sync
      if (channelRef.current) {
        channelRef.current.send({
          type: "broadcast",
          event: "sync-data",
          payload: { type: "CONTACTS_UPDATED", sender: session?.user?.id }
        });
      }
    }
  };

  const handleCopyContactMessage = (contact: Contact) => {
    const finalLink = getFinalLink(computedLink, includeToken);
    const msg = buildMessage(pesan, contact.nama, finalLink, contact.token);

    navigator.clipboard.writeText(msg);

    // Tandai sebagai terkirim (sama seperti tombol Kirim)
    handleMarkAsSent(contact);

    setFeedback(`Pesan untuk ${contact.nama} disalin!`);
  };

  const handleCopyGuestLink = (contact: Contact) => {
    const finalLink = getFinalLink(computedLink, includeToken);
    const guestLink = finalLink
      .replace(/\{nama\}/g, encodeURIComponent(contact.nama))
      .replace(/\{id\}/g, contact.token);
    
    navigator.clipboard.writeText(guestLink);
    setFeedback(`Link untuk ${contact.nama} telah disalin!`);
  };

  const handleSendSingleContact = (contact: Contact) => {
    if (templateInvalid) {
      setErrorMessage("Lengkapi template pesan. Template wajib berisi {nama} dan {link}.");
      return;
    }

    const finalLink = getFinalLink(computedLink, includeToken);
    const waUrl = `https://wa.me/${contact.nomor}?text=${encodeURIComponent(buildMessage(pesan, contact.nama, finalLink, contact.token))}`;
    window.open(waUrl, "_blank");

    handleMarkAsSent(contact);
  };

  const handleExportExcel = () => {
    const presentContacts = contacts.filter(c => c.is_present);

    if (presentContacts.length === 0) {
      setErrorMessage("Tidak ada data tamu hadir untuk di-export.");
      return;
    }

    // Urutkan berdasarkan waktu check-in (paling awal di atas)
    const sortedContacts = [...presentContacts].sort((a, b) => {
      const timeA = a.present_at ? new Date(a.present_at).getTime() : 0;
      const timeB = b.present_at ? new Date(b.present_at).getTime() : 0;
      return timeA - timeB;
    });

    const dataToExport = sortedContacts.map((c, index) => ({
      "No": index + 1,
      "Nama": c.nama,
      "Nomor": c.nomor,
      "Priority": c.priority,
      "Kategori": c.kategori,
      "Status": "Hadir",
      "Waktu Datang": c.present_at ? new Date(c.present_at).toLocaleString("id-ID") : "-"
    }));

    const worksheet = XLSX.utils.json_to_sheet(dataToExport);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Tamu Hadir");

    // Auto-size columns
    const max_width = dataToExport.reduce((w, r) => Math.max(w, r.Nama.length), 10);
    worksheet["!cols"] = [{ wch: 5 }, { wch: max_width + 5 }, { wch: 15 }, { wch: 10 }, { wch: 15 }, { wch: 10 }, { wch: 20 }];

    const userName = username || session?.user?.email?.split("@")[0] || "User";
    const dateStr = new Date().toLocaleDateString("id-ID").replace(/\//g, "-");

    XLSX.writeFile(workbook, `${userName}_${dateStr}.xlsx`);
    setFeedback("Berhasil meng-export data tamu hadir.");
  };

  const sentCount = contacts.filter(c => c.is_sent || sentNomors.includes(c.nomor)).length;

  const previewMessage = useMemo(() => {
    if (!pesan.trim()) return "";
    const namaPreview = contacts[0]?.nama ?? "Budi Santoso";

    const finalLinkPreview = getFinalLink(computedLink, includeToken);
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

    if (keyword) {
      processed = processed.filter((contact) => {
        const byName = contact.nama.toLowerCase().includes(keyword);
        const byNumber = contact.nomor.toLowerCase().includes(keyword);
        return byName || byNumber;
      });
    }

    return processed.sort((a, b) => {
      if (sortConfig.key === 'no') return 0;
      let valA = a[sortConfig.key as keyof Contact];
      let valB = b[sortConfig.key as keyof Contact];
      if (typeof valA === 'string' && typeof valB === 'string') {
        return sortConfig.direction === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }
      if (valA! < valB!) return sortConfig.direction === 'asc' ? -1 : 1;
      if (valA! > valB!) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [guestbookBaseList, guestbookQuery, sortConfig]);

  const paginatedGuests = useMemo(() => {
    const startIndex = (currentPage - 1) * rowsPerPage;
    return filteredGuestbook.slice(startIndex, startIndex + rowsPerPage);
  }, [filteredGuestbook, currentPage, rowsPerPage]);

  const totalPages = Math.ceil(filteredGuestbook.length / rowsPerPage);

  useEffect(() => {
    setCurrentPage(1);
  }, [guestbookQuery, rowsPerPage]);

  const toggleSort = (key: keyof Contact | 'no') => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const dashboardStats = useMemo(() => {
    const total = contacts.length;
    const sent = contacts.filter(c => c.is_sent || sentNomors.includes(c.nomor)).length;
    const present = contacts.filter(c => c.is_present).length;

    const vips = contacts.filter(c => c.priority?.toUpperCase() === "VIP" || c.priority?.toUpperCase() === "VVIP");
    const totalVip = vips.length;
    const vipPresent = vips.filter(c => c.is_present).length;

    const manualCount = contacts.filter(c => c.added_via === "manual").length;
    const todayManual = contacts.filter(c => {
      if (c.added_via !== "manual") return false;
      const today = new Date().toISOString().split("T")[0];
      return c.created_at?.startsWith(today);
    }).length;

    const pending = total - sent;
    const attendanceRate = sent > 0 ? (present / sent) * 100 : 0;
    const deliveryRate = total > 0 ? (sent / total) * 100 : 0;

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const addedToday = contacts.filter(c => new Date(c.created_at).getTime() >= todayStart.getTime()).length;
    const todayCheckin = contacts.filter(c => c.is_present && c.present_at && new Date(c.present_at).getTime() >= todayStart.getTime()).length;

    const vipAttendanceRate = totalVip > 0 ? (vipPresent / totalVip) * 100 : 0;

    const deliveryStatus = deliveryRate >= 95 ? "Lengkap" : "Berjalan";
    const attendanceStatus = attendanceRate > 70 ? "Sangat Baik" : "Stabil";
    const vipStatus = vipAttendanceRate > 80 ? "Sempurna" : "Pantau VIP";

    const recentActivity = [...contacts]
      .filter(c => c.is_present)
      .sort((a, b) => {
        const timeA = a.present_at ? new Date(a.present_at).getTime() : 0;
        const timeB = b.present_at ? new Date(b.present_at).getTime() : 0;
        return timeB - timeA;
      });

    const activityTotalPages = Math.ceil(recentActivity.length / activityRowsPerPage);

    // Stats by Priority
    const priorities = ["Reguler", "VIP", "VVIP"];
    const statsByPriority = priorities.map(p => {
      const group = contacts.filter(c => c.priority === p);
      const totalInGroup = group.length;
      const presentInGroup = group.filter(c => c.is_present).length;
      return { label: p, total: totalInGroup, present: presentInGroup };
    });

    // Stats by Category
    const categories = Array.from(new Set(contacts.map(c => c.kategori || "-")));
    const statsByCategory = categories.map(cat => {
      const group = contacts.filter(c => (c.kategori || "-") === cat);
      const totalInGroup = group.length;
      const presentInGroup = group.filter(c => c.is_present).length;
      return { label: cat === "-" ? "Lainnya" : cat, total: totalInGroup, present: presentInGroup };
    });

    return {
      total, sent, present, vipPresent, pending,
      attendanceRate, deliveryRate, recentActivity,
      addedToday, vipAttendanceRate, totalVip, todayCheckin,
      deliveryStatus, attendanceStatus, vipStatus,
      manualCount, todayManual, statsByPriority, statsByCategory
    };
  }, [contacts, sentNomors]);

  const paginatedActivity = useMemo(() => {
    const startIndex = (activityPage - 1) * activityRowsPerPage;
    return dashboardStats.recentActivity.slice(startIndex, startIndex + activityRowsPerPage);
  }, [dashboardStats.recentActivity, activityPage, activityRowsPerPage]);

  const activityTotalPages = Math.ceil(dashboardStats.recentActivity.length / activityRowsPerPage);

  // Dapatkan daftar kategori unik untuk saran (datalist)
  const uniqueCategories = useMemo(() => {
    const cats = contacts
      .map(c => c.kategori)
      .filter(k => k && k !== "-")
      .map(k => k.trim());
    return Array.from(new Set(cats)).sort();
  }, [contacts]);

  const getSortIcon = (key: keyof Contact | 'no') => {
    if (sortConfig.key !== key) return "↕";
    return sortConfig.direction === 'asc' ? "↑" : "↓";
  };

  if (
    (isInitializing && !sessionInfo) ||
    (session && isRoleChecking && !sessionInfo) ||
    (sessionInfo && sessionInfo.role !== "user")
  ) {
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
          <button
            className={styles.menuToggle}
            onClick={() => setIsSidebarMinimized(!isSidebarMinimized)}
            title={isSidebarMinimized ? "Expand Sidebar" : "Collapse Sidebar"}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="12" x2="21" y2="12"></line>
              <line x1="3" y1="6" x2="21" y2="6"></line>
              <line x1="3" y1="18" x2="21" y2="18"></line>
            </svg>
          </button>
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
        <nav className={`${styles.sidebar} ${isSidebarMinimized ? styles.sidebarMinimized : ""}`}>
          <button
            className={`${styles.sidebarItem} ${activeView === "dashboard" ? styles.sidebarItemActive : ""}`}
            onClick={() => setActiveView("dashboard")}
          >
            <span className={styles.sidebarIcon}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></svg>
            </span>
            <span className={styles.sidebarLabel}>Dashboard</span>
          </button>
          <button
            className={`${styles.sidebarItem} ${activeView === "send" ? styles.sidebarItemActive : ""}`}
            onClick={() => setActiveView("send")}
          >
            <span className={styles.sidebarIcon}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2L11 13" /><path d="M22 2l-7 20-4-9-9-4 20-7z" /></svg>
            </span>
            <span className={styles.sidebarLabel}>Kirim Pesan</span>
          </button>
          <button
            className={`${styles.sidebarItem} ${activeView === "guestbook" ? styles.sidebarItemActive : ""}`}
            onClick={() => setActiveView("guestbook")}
          >
            <span className={styles.sidebarIcon}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
            </span>
            <span className={styles.sidebarLabel}>Buku Tamu</span>
          </button>
          <button
            className={`${styles.sidebarItem} ${activeView === "scan" ? styles.sidebarItemActive : ""}`}
            onClick={() => setActiveView("scan")}
          >
            <span className={styles.sidebarIcon}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2" /><path d="M17 3h2a2 2 0 0 1 2 2v2" /><path d="M21 17v2a2 2 0 0 1-2 2h-2" /><path d="M7 21H5a2 2 0 0 1-2-2v-2" /><rect x="7" y="7" width="10" height="10" rx="1" /></svg>
            </span>
            <span className={styles.sidebarLabel}>Scan QR</span>
          </button>
        </nav>

        {/* Main Content */}
        <main className={styles.mainContent}>
          <div className={styles.contentMaxWidth}>

            {activeView === "dashboard" ? (
              <div className={styles.dashboardContainer}>
                <div className={styles.dashboardBanner}>
                  <img src="/3.jpg" alt="Wedding Banner" />
                </div>
                <h2 className={styles.pageTitle}>
                  Halo, {session?.user?.email?.split('@')[0] ? session.user.email.split('@')[0].charAt(0).toUpperCase() + session.user.email.split('@')[0].slice(1) : "Pengantin"}
                </h2>
                <p className={styles.pageSubtitle}>Ringkasan statistik dan aktivitas tamu secara real-time.</p>

                {/* Stats Row */}
                <div className={styles.premiumStatsRow}>
                  {/* Card 1: Total Database */}
                  <div className={styles.premiumStatCard}>
                    <div className={styles.pStatHeader}>
                      <div className={`${styles.pStatIcon} ${styles.pIconBlue}`}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
                      </div>
                      <span className={styles.pStatTrend} style={{ background: "#EBF2FF", color: "#3B82F6" }}>+{dashboardStats.addedToday} Baru</span>
                    </div>
                    <div className={styles.pStatBody}>
                      <div className={styles.panelTitle}>Total Tamu</div>
                      <div className={styles.pStatValue}>{dashboardStats.total}</div>
                    </div>
                  </div>

                  {/* Card 2: Ambil Souvenir */}
                  <div className={styles.premiumStatCard}>
                    <div className={styles.pStatHeader}>
                      <div className={`${styles.pStatIcon} ${styles.pIconGreen}`}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 12v10H4V12" /><path d="M2 7h20v5H2z" /><path d="M12 22V7" /><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" /><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" /></svg>
                      </div>
                      <span className={styles.pStatTrend} style={{
                        background: "#dcfce7",
                        color: "#16a34a"
                      }}>
                        Terdistribusi
                      </span>
                    </div>
                    <div className={styles.pStatBody}>
                      <div className={styles.panelTitle}>Souvenir Tamu</div>
                      <div className={styles.pStatValue}>{dashboardStats.present}</div>
                    </div>
                  </div>

                  {/* Card 3: Tamu Tambahan */}
                  <div className={styles.premiumStatCard}>
                    <div className={styles.pStatHeader}>
                      <div className={`${styles.pStatIcon} ${styles.pIconIndigo}`}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><line x1="19" y1="8" x2="19" y2="14" /><line x1="16" y1="11" x2="22" y2="11" /></svg>
                      </div>
                      <span className={styles.pStatTrend} style={{
                        background: "#e0e7ff",
                        color: "#4338ca"
                      }}>
                        +{dashboardStats.todayManual} Hari ini
                      </span>
                    </div>
                    <div className={styles.pStatBody}>
                      <div className={styles.panelTitle}>Tamu Tambahan</div>
                      <div className={styles.pStatValue}>{dashboardStats.manualCount}</div>
                    </div>
                  </div>

                  {/* Card 4: VIP Performance */}
                  <div className={styles.premiumStatCard}>
                    <div className={styles.pStatHeader}>
                      <div className={`${styles.pStatIcon} ${styles.pIconAmber}`}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
                      </div>
                      <span className={styles.pStatTrend} style={{
                        background: "#fef3c7",
                        color: "#b45309"
                      }}>
                        {dashboardStats.vipPresent} Hadir
                      </span>
                    </div>
                    <div className={styles.pStatBody}>
                      <div className={styles.panelTitle}>Tamu Prioritas</div>
                      <div className={styles.pStatValue}>{dashboardStats.totalVip}</div>
                    </div>
                  </div>
                </div>

                {/* Progress Row (Two Cards) */}
                <div className={styles.dashboardGridRow}>
                  <div className={styles.panel} style={{ flex: 1, margin: 0 }}>
                    <div className={styles.panelBody} style={{ padding: "20px" }}>
                      <div className={styles.progressRow}>
                        <div className={styles.circularContainer}>
                          <svg width="64" height="64" viewBox="0 0 64 64">
                            <circle cx="32" cy="32" r="28" stroke="#f3f4f6" strokeWidth="6" fill="none" />
                            <circle cx="32" cy="32" r="28" stroke="#10b981" strokeWidth="6" fill="none"
                              strokeDasharray="175.9"
                              strokeDashoffset={175.9 - (175.9 * dashboardStats.attendanceRate) / 100}
                              strokeLinecap="round"
                              transform="rotate(-90 32 32)"
                              style={{ transition: "stroke-dashoffset 0.8s ease" }}
                            />
                          </svg>
                          <span className={styles.circularPercent}>{Math.round(dashboardStats.attendanceRate)}%</span>
                        </div>
                        <div className={styles.progressDetail}>
                          <div className={styles.panelTitle}>Statistik Check-in</div>
                          <div className={styles.progressCount}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18, color: "#10b981" }}><polyline points="9 11 12 14 22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
                            <span className={styles.activityName}>{dashboardStats.present}</span>
                            <span className={styles.activityTime}>/ {dashboardStats.sent} tamu</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className={styles.panel} style={{ flex: 1, margin: 0 }}>
                    <div className={styles.panelBody} style={{ padding: "20px" }}>
                      <div className={styles.progressRow}>
                        <div className={styles.circularContainer}>
                          <svg width="64" height="64" viewBox="0 0 64 64">
                            <circle cx="32" cy="32" r="28" stroke="#f3f4f6" strokeWidth="6" fill="none" />
                            <circle cx="32" cy="32" r="28" stroke="var(--accent)" strokeWidth="6" fill="none"
                              strokeDasharray="175.9"
                              strokeDashoffset={175.9 - (175.9 * dashboardStats.deliveryRate) / 100}
                              strokeLinecap="round"
                              transform="rotate(-90 32 32)"
                              style={{ transition: "stroke-dashoffset 0.8s ease" }}
                            />
                          </svg>
                          <span className={styles.circularPercent}>{Math.round(dashboardStats.deliveryRate)}%</span>
                        </div>
                        <div className={styles.progressDetail}>
                          <div className={styles.panelTitle}>Statistik Undangan</div>
                          <div className={styles.progressCount}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18, color: "var(--accent)" }}><polyline points="9 11 12 14 22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
                            <span className={styles.activityName}>{dashboardStats.sent}</span>
                            <span className={styles.activityTime}>/ {dashboardStats.total} tamu</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className={styles.dashboardSection}>
                  <h3 className={styles.pageTitle}>By Priority</h3>
                  <div className={styles.progressGridFlex}>
                    {dashboardStats.statsByPriority.map(stat => (
                      <div key={stat.label} className={`${styles.progressCard} ${styles.progressCardFlex}`}>
                        <div className={styles.progressDetail} style={{ padding: 0, marginBottom: 12 }}>
                          <div className={styles.panelTitle}>{stat.label}</div>
                          <div className={styles.progressCount}>
                            <span className={styles.activityName}>{stat.present}</span>
                            <span className={styles.activityTime}>/ {stat.total} tamu</span>
                          </div>
                        </div>
                        <div className={styles.progressBarBg}>
                          <div
                            className={`${styles.progressBarFill} ${stat.label === "Reguler" ? styles.barReguler : stat.label === "VIP" ? styles.barVIP : stat.label === "VVIP" ? styles.barVVIP : ""}`}
                            style={{ width: `${stat.total > 0 ? (stat.present / stat.total) * 100 : 0}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className={styles.dashboardSection}>
                  <h3 className={styles.pageTitle}>By Kategori</h3>
                  <div className={styles.progressGrid}>
                    {dashboardStats.statsByCategory.map(stat => {
                      const catValue = stat.label === "Lainnya" ? "-" : stat.label;
                      const colors = getCategoryColor(catValue);
                      return (
                        <div key={stat.label} className={styles.progressCard}>
                          <div className={styles.progressDetail} style={{ padding: 0, marginBottom: 12 }}>
                            <div className={styles.panelTitle}>{stat.label}</div>
                            <div className={styles.progressCount}>
                              <span className={styles.activityName}>{stat.present}</span>
                              <span className={styles.activityTime}>/ {stat.total} tamu</span>
                            </div>
                          </div>
                          <div className={styles.progressBarBg} style={{ backgroundColor: "rgba(0,0,0,0.06)" }}>
                            <div
                              className={styles.progressBarFill}
                              style={{
                                width: `${stat.total > 0 ? (stat.present / stat.total) * 100 : 0}%`,
                                background: `linear-gradient(90deg, ${colors.text}, ${colors.text}bb)`,
                                boxShadow: `0 2px 6px ${colors.text}33`
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Recent Activity Section (Using Scan Menu History UI) */}
                <div className={styles.dashboardSection} style={{ marginTop: "var(--space-2)" }}>
                  <div className={styles.panel}>
                    <div className={styles.panelHeader} style={{ background: "rgba(0,0,0,0.02)" }}>
                      <span className={styles.panelTitle}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16 }}><path d="M12 20v-6M6 20V10M18 20V4" /></svg>
                        Riwayat Kehadiran Tamu
                      </span>
                      <span className={styles.pStatTrend} style={{ background: "var(--accent-light)", color: "var(--accent-dark)" }}>Real-time</span>
                    </div>
                    <div className={styles.panelBody}>
                      <div className={styles.activityList}>
                        {paginatedActivity.length > 0 ? (
                          paginatedActivity.map(activity => (
                            <div key={activity.id} className={styles.activityItem}>
                              <div className={styles.activityAvatar}>
                                {activity.nama.charAt(0).toUpperCase()}
                              </div>
                              <div className={styles.activityContent}>
                                <div className={styles.activityTop}>
                                  <span className={styles.activityName}>{activity.nama}</span>
                                  {(activity.priority?.toUpperCase() === "VIP" || activity.priority?.toUpperCase() === "VVIP") && (
                                    <span className={`${styles.prioBadgeSmall} ${activity.priority === "VVIP" ? styles.prioVVIP : styles.prioVIP}`}>
                                      {activity.priority}
                                    </span>
                                  )}
                                </div>
                                <div className={styles.activityBottom}>
                                  <svg className={styles.activityIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                                  <span className={styles.activityTime}>
                                    Hadir jam {activity.present_at ? new Date(activity.present_at).toLocaleTimeString("id-ID", { hour: '2-digit', minute: '2-digit' }) : "-"}
                                  </span>
                                </div>
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className={styles.emptyActivity}>Belum ada tamu yang hadir hari ini.</div>
                        )}
                      </div>

                      {/* Activity Pagination */}
                      {dashboardStats.recentActivity.length > activityRowsPerPage && (
                        <div className={styles.paginationContainer} style={{ border: "none", padding: "16px 0 0" }}>
                          <div className={styles.paginationInfo}>
                            <strong>{Math.min((activityPage - 1) * activityRowsPerPage + 1, dashboardStats.recentActivity.length)}</strong> – <strong>{Math.min(activityPage * activityRowsPerPage, dashboardStats.recentActivity.length)}</strong> dari <strong>{dashboardStats.recentActivity.length}</strong>
                          </div>
                          <div className={styles.paginationNav}>
                            <button
                              className={styles.pageNavBtn}
                              disabled={activityPage === 1}
                              onClick={() => setActivityPage(prev => prev - 1)}
                            >
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}><polyline points="15 18 9 12 15 6" /></svg>
                            </button>

                            {Array.from({ length: activityTotalPages }, (_, i) => i + 1)
                              .filter(p => p === 1 || p === activityTotalPages || (p >= activityPage - 1 && p <= activityPage + 1))
                              .map((p, i, arr) => {
                                const items = [];
                                if (i > 0 && p !== arr[i - 1] + 1) {
                                  items.push(<span key={`ell-${p}`} className={styles.pageEllipsis}>...</span>);
                                }
                                items.push(
                                  <button
                                    key={p}
                                    className={`${styles.pageNumber} ${activityPage === p ? styles.pageActive : ""}`}
                                    onClick={() => setActivityPage(p)}
                                  >
                                    {p}
                                  </button>
                                );
                                return items;
                              })}

                            <button
                              className={styles.pageNavBtn}
                              disabled={activityPage === activityTotalPages}
                              onClick={() => setActivityPage(prev => prev + 1)}
                            >
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}><polyline points="9 18 15 12 9 6" /></svg>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : activeView === "send" ? (
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
                    <div className={styles.hint}>Format: <strong>Nama, Nomor</strong> (Satu baris per tamu).</div>

                    <div className={styles.importSettings}>
                      <div className={styles.importField}>
                        <label className={styles.importLabel}>Set Kategori</label>
                        {!isAddingNewCategoryImport ? (
                          <select
                            className={styles.importSelect}
                            value={importCategory}
                            onChange={(e) => {
                              if (e.target.value === "ADD_NEW") {
                                setIsAddingNewCategoryImport(true);
                              } else {
                                setImportCategory(e.target.value);
                              }
                            }}
                          >
                            <option value="-">Tanpa Kategori</option>
                            {uniqueCategories.map(cat => (
                              <option key={cat} value={cat}>{cat}</option>
                            ))}
                            {tempImportCategory && !uniqueCategories.includes(tempImportCategory) && (
                              <option value={tempImportCategory}>{tempImportCategory}</option>
                            )}
                            <option value="ADD_NEW">+ Tambah Kategori Baru...</option>
                          </select>
                        ) : (
                          <div className={styles.manualInputRow}>
                            <input
                              type="text"
                              className={styles.importSelect}
                              placeholder="Ketik kategori baru..."
                              autoFocus
                              value={newCategoryValueImport}
                              onChange={(e) => setNewCategoryValueImport(e.target.value)}
                            />
                            <button
                              className={styles.miniBtnPrimary}
                              onClick={() => {
                                if (newCategoryValueImport.trim()) {
                                  const newVal = newCategoryValueImport.trim();
                                  setTempImportCategory(newVal);
                                  setImportCategory(newVal);
                                }
                                setIsAddingNewCategoryImport(false);
                                setNewCategoryValueImport("");
                              }}
                            >
                              Simpan
                            </button>
                            <button
                              className={styles.miniBtnGhost}
                              onClick={() => {
                                setIsAddingNewCategoryImport(false);
                                setNewCategoryValueImport("");
                              }}
                            >
                              Batal
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    <button
                      className={styles.btn}
                      style={{ marginTop: "16px" }}
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
                            onChange={(e) => handleUpdateSettings({ include_token: e.target.checked })}
                          />
                          <span className={styles.slider}></span>
                        </label>
                      </div>
                    </div>

                    {/* Field Link dihapus karena sudah otomatis berbasis username */}

                    <div className={styles.field}>
                      <label htmlFor="pesan" className={styles.label}>Template Pesan <span className={styles.req}>*</span></label>
                      <div className={styles.inputWrap}>
                        <textarea id="pesan" className={styles.textarea} placeholder={"Halo {nama}, ini link undangan Anda: {link}"} value={pesan} onChange={(e) => handleUpdateSettings({ pesan: e.target.value })} />
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
                        <div className={styles.previewLabelRow}>
                          <div className={styles.previewLabel}>Pratinjau Pesan</div>
                          <button className={styles.copyBtn} onClick={handleCopyPreview}>
                            {copied ? "Tersalin!" : "Salin"}
                          </button>
                        </div>
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
                                <span className={styles.contactNumber}>
                                  {contact.nomor.startsWith("99") && contact.nomor.length >= 12 ? "" : contact.nomor}
                                </span>
                              </div>
                              <div className={styles.rowActions}>
                                {isSent ? (
                                  <span className={styles.sentBtn}>Terkirim</span>
                                ) : contact.nomor.startsWith("99") && contact.nomor.length >= 12 ? (
                                  <button
                                    className={styles.miniBtn}
                                    onClick={() => handleCopyContactMessage(contact)}
                                    style={{ background: "var(--accent-dark)", border: "none", color: "white", cursor: "pointer" }}
                                  >
                                    Salin
                                  </button>
                                ) : (
                                  <a
                                    href={`https://wa.me/${contact.nomor}?text=${encodeURIComponent(buildMessage(pesan, contact.nama, getFinalLink(computedLink, includeToken), contact.token))}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className={styles.miniBtn}
                                    onClick={() => handleMarkAsSent(contact)}
                                  >
                                    Kirim
                                  </a>
                                )}
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
                      <button className={styles.btn} onClick={() => setIsAddingGuest(true)} style={{ background: "var(--accent-dark)" }}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16, marginRight: 8 }}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                        Tambah Tamu
                      </button>
                      <button className={styles.btn} onClick={handleExportExcel} style={{ background: "#4f46e5" }}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16, marginRight: 8 }}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                        Export Excel
                      </button>
                    </div>
                  </div>
                </div>

                {/* Guest Table */}
                <div className={styles.panel}>
                  <div className={styles.egmsTable}>
                    <div className={styles.egmsTableHead}>
                      <span className={styles.egmsHeadCell}>No</span>
                      <span className={styles.egmsHeadCell} onClick={() => toggleSort('nama')} style={{ cursor: 'pointer' }}>Nama Tamu {getSortIcon('nama')}</span>
                      <span className={styles.egmsHeadCell} onClick={() => toggleSort('priority')} style={{ cursor: 'pointer' }}>Priority {getSortIcon('priority')}</span>
                      <span className={styles.egmsHeadCell} onClick={() => toggleSort('kategori')} style={{ cursor: 'pointer' }}>Kategori {getSortIcon('kategori')}</span>
                      <span className={styles.egmsHeadCell} onClick={() => toggleSort('is_present')} style={{ cursor: 'pointer' }}>Status {getSortIcon('is_present')}</span>
                      <span className={styles.egmsHeadCell}>Action</span>
                    </div>

                    {filteredGuestbook.length === 0 && !isFetching && (
                      <div className={styles.egmsRowEmpty}>Belum ada tamu. Klik Search atau simpan data dari tab Send.</div>
                    )}

                    {paginatedGuests.map((contact, index) => {
                      const isSent = contact.is_sent || sentNomors.includes(contact.nomor);
                      const globalIndex = (currentPage - 1) * rowsPerPage + index + 1;
                      return (
                        <div key={contact.id} className={styles.egmsRow}>
                          <span className={styles.egmsCell}>{globalIndex}</span>
                          <div className={styles.egmsCellStrong}>{contact.nama}</div>
                          <div className={styles.egmsCell}>
                            <span className={`${styles.priorityBadge} ${styles['prio' + contact.priority]}`}>
                              {contact.priority}
                            </span>
                          </div>
                          <div className={styles.egmsCell}>
                            {(() => {
                              const colors = getCategoryColor(contact.kategori);
                              return (
                                <span
                                  className={styles.categoryBadge}
                                  style={{ backgroundColor: colors.bg, color: colors.text, border: "none" }}
                                >
                                  {contact.kategori || "-"}
                                </span>
                              );
                            })()}
                          </div>
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

                  {/* Pagination Component */}
                  {filteredGuestbook.length > 0 && (
                    <div className={styles.paginationContainer}>
                      <div className={styles.paginationInfo}>
                        Menampilkan <strong>{Math.min((currentPage - 1) * rowsPerPage + 1, filteredGuestbook.length)}</strong> – <strong>{Math.min(currentPage * rowsPerPage, filteredGuestbook.length)}</strong> dari <strong>{filteredGuestbook.length}</strong> tamu
                      </div>

                      <div className={styles.paginationRight}>
                        <div className={styles.rowsSelector}>
                          <span>Baris:</span>
                          <select value={rowsPerPage} onChange={(e) => setRowsPerPage(Number(e.target.value))}>
                            <option value={10}>10</option>
                            <option value={25}>25</option>
                            <option value={50}>50</option>
                          </select>
                        </div>

                        <div className={styles.paginationNav}>
                          <button
                            className={styles.pageNavBtn}
                            disabled={currentPage === 1}
                            onClick={() => setCurrentPage(prev => prev - 1)}
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}><polyline points="15 18 9 12 15 6" /></svg>
                          </button>

                          {Array.from({ length: totalPages }, (_, i) => i + 1)
                            .filter(p => p === 1 || p === totalPages || (p >= currentPage - 1 && p <= currentPage + 1))
                            .map((p, i, arr) => {
                              const items = [];
                              if (i > 0 && p !== arr[i - 1] + 1) {
                                items.push(<span key={`ell-${p}`} className={styles.pageEllipsis}>...</span>);
                              }
                              items.push(
                                <button
                                  key={p}
                                  className={`${styles.pageNumber} ${currentPage === p ? styles.pageActive : ""}`}
                                  onClick={() => setCurrentPage(p)}
                                >
                                  {p}
                                </button>
                              );
                              return items;
                            })}

                          <button
                            className={styles.pageNavBtn}
                            disabled={currentPage === totalPages}
                            onClick={() => setCurrentPage(prev => prev + 1)}
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}><polyline points="9 18 15 12 9 6" /></svg>
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                <ScannerView
                  onScanSuccess={handleScanSuccess}
                  scannedContact={scannedContact}
                  onReset={() => setScannedContact(null)}
                />

                <div className={styles.panel} style={{ marginTop: "var(--space-2)" }}>
                  <div className={styles.panelHeader}>
                    <span className={styles.panelTitle}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16 }}><path d="M12 20v-6M6 20V10M18 20V4" /></svg>
                      Riwayat Kehadiran Tamu
                    </span>
                  </div>
                  <div className={styles.panelBody}>
                    <div className={styles.activityList}>
                      {paginatedActivity.length > 0 ? (
                        paginatedActivity.map(activity => (
                          <div key={activity.id} className={styles.activityItem}>
                            <div className={styles.activityAvatar}>
                              {activity.nama.charAt(0).toUpperCase()}
                            </div>
                            <div className={styles.activityContent}>
                              <div className={styles.activityTop}>
                                <span className={styles.activityName}>{activity.nama}</span>
                                {(activity.priority?.toUpperCase() === "VIP" || activity.priority?.toUpperCase() === "VVIP") && (
                                  <span className={`${styles.prioBadgeSmall} ${activity.priority === "VVIP" ? styles.prioVVIP : styles.prioVIP}`}>
                                    {activity.priority}
                                  </span>
                                )}
                              </div>
                              <div className={styles.activityBottom}>
                                <svg className={styles.activityIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                                <span className={styles.activityTime}>
                                  Hadir jam {activity.present_at ? new Date(activity.present_at).toLocaleTimeString("id-ID", { hour: '2-digit', minute: '2-digit' }) : "-"}
                                </span>
                              </div>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className={styles.emptyActivity}>Belum ada tamu yang hadir hari ini.</div>
                      )}
                    </div>

                    {/* Activity Pagination */}
                    {dashboardStats.recentActivity.length > activityRowsPerPage && (
                      <div className={styles.paginationContainer} style={{ border: "none", padding: "16px 0 0" }}>
                        <div className={styles.paginationInfo}>
                          <strong>{Math.min((activityPage - 1) * activityRowsPerPage + 1, dashboardStats.recentActivity.length)}</strong> – <strong>{Math.min(activityPage * activityRowsPerPage, dashboardStats.recentActivity.length)}</strong> dari <strong>{dashboardStats.recentActivity.length}</strong>
                        </div>
                        <div className={styles.paginationNav}>
                          <button
                            className={styles.pageNavBtn}
                            disabled={activityPage === 1}
                            onClick={() => setActivityPage(prev => prev - 1)}
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}><polyline points="15 18 9 12 15 6" /></svg>
                          </button>

                          {Array.from({ length: activityTotalPages }, (_, i) => i + 1)
                            .filter(p => p === 1 || p === activityTotalPages || (p >= activityPage - 1 && p <= activityPage + 1))
                            .map((p, i, arr) => {
                              const items = [];
                              if (i > 0 && p !== arr[i - 1] + 1) {
                                items.push(<span key={`ell-${p}`} className={styles.pageEllipsis}>...</span>);
                              }
                              items.push(
                                <button
                                  key={p}
                                  className={`${styles.pageNumber} ${activityPage === p ? styles.pageActive : ""}`}
                                  onClick={() => setActivityPage(p)}
                                >
                                  {p}
                                </button>
                              );
                              return items;
                            })}

                          <button
                            className={styles.pageNavBtn}
                            disabled={activityPage === activityTotalPages}
                            onClick={() => setActivityPage(prev => prev + 1)}
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}><polyline points="9 18 15 12 9 6" /></svg>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </main>
      </div>

      {/* ─── Bottom Navigation (mobile only) ─── */}
      <nav className={styles.bottomNav}>
        <button className={`${styles.bottomNavItem} ${activeView === "dashboard" ? styles.bottomNavItemActive : ""}`} onClick={() => setActiveView("dashboard")}>
          <span className={styles.bottomNavIcon}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></svg>
          </span>
          Dashboard
        </button>
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
              <h3 className={styles.editModalTitle}>Informasi Tamu</h3>
              <button className={styles.editModalClose} onClick={handleCloseEdit}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>

            {/* Body */}
            <div className={styles.editModalBody}>
              {/* Row: Nama & Priority */}
              <div className={styles.editFormRow}>
                <div className={styles.editField} style={{ flex: 3 }}>
                  <label className={styles.editLabel}>Nama Tamu</label>
                  <input
                    type="text"
                    className={styles.editInput}
                    value={editingContact.nama}
                    onChange={(e) => setEditingContact({ ...editingContact, nama: e.target.value })}
                    placeholder="Nama tamu"
                  />
                </div>
                <div className={styles.editField} style={{ flex: 2 }}>
                  <label className={styles.editLabel}>Priority</label>
                  <select
                    className={styles.editInput}
                    value={editingContact.priority}
                    onChange={(e) => setEditingContact({ ...editingContact, priority: e.target.value })}
                  >
                    <option value="Reguler">Reguler</option>
                    <option value="VIP">VIP</option>
                    <option value="VVIP">VVIP</option>
                  </select>
                </div>
              </div>

              {/* Kategori field with Dropdown + Manual Add */}
              <div className={styles.editField}>
                <label className={styles.editLabel}>Kategori</label>
                {!isAddingNewCategory ? (
                  <div className={styles.selectWithAdd}>
                    <select
                      className={styles.editInput}
                      value={editingContact.kategori || "-"}
                      onChange={(e) => {
                        if (e.target.value === "ADD_NEW") {
                          setIsAddingNewCategory(true);
                        } else {
                          setEditingContact({ ...editingContact, kategori: e.target.value });
                        }
                      }}
                    >
                      <option value="-">Tanpa Kategori</option>
                      {uniqueCategories.map(cat => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                      <option value="ADD_NEW">+ Tambah Kategori Baru...</option>
                    </select>
                  </div>
                ) : (
                  <div className={styles.manualInputRow}>
                    <input
                      type="text"
                      className={styles.editInput}
                      autoFocus
                      placeholder="Ketik kategori baru..."
                      value={newCategoryValue}
                      onChange={(e) => setNewCategoryValue(e.target.value)}
                    />
                    <button
                      className={styles.miniBtnPrimary}
                      onClick={() => {
                        if (newCategoryValue.trim()) {
                          setEditingContact({ ...editingContact, kategori: newCategoryValue.trim() });
                          setIsAddingNewCategory(false);
                          setNewCategoryValue("");
                        }
                      }}
                    >
                      Oke
                    </button>
                    <button
                      className={styles.miniBtnGhost}
                      onClick={() => setIsAddingNewCategory(false)}
                    >
                      Batal
                    </button>
                  </div>
                )}
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
                <label className={styles.editLabel}>QR Code & Link</label>
                <div className={styles.editQrBox}>
                  <QRCodeSVG value={editingContact.token || "PENDING"} size={100} />
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', marginTop: '4px' }}>
                    <span className={styles.editQrToken}>{editingContact.token || "—"}</span>
                    <button 
                      className={styles.miniBtnPrimary} 
                      onClick={() => handleCopyGuestLink(editingContact)}
                      style={{ fontSize: '11px', padding: '4px 12px' }}
                    >
                      Salin Link
                    </button>
                  </div>
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

      {/* ─── Add Guest Modal ─── */}
      {isAddingGuest && (
        <div className={styles.modalOverlay} onClick={() => setIsAddingGuest(false)}>
          <div className={styles.editModal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.editModalHead}>
              <h3 className={styles.editModalTitle}>Tambah Tamu</h3>
              <button className={styles.editModalClose} onClick={() => setIsAddingGuest(false)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>

            <div className={styles.editModalBody}>
              <div className={styles.editField}>
                <label className={styles.editLabel}>Nama Tamu</label>
                <input
                  type="text"
                  className={styles.editInput}
                  value={newGuestData.nama}
                  onChange={(e) => setNewGuestData({ ...newGuestData, nama: e.target.value })}
                  placeholder="Ketik nama tamu..."
                  autoFocus
                />
              </div>
              <p style={{ fontSize: "12px", color: "var(--text-hint)", marginTop: "8px" }}>
                Tamu akan otomatis ditambahkan ke kategori <strong>Manual</strong> dengan prioritas <strong>Reguler</strong> dan status <strong>Hadir</strong>.
              </p>
            </div>

            <div className={styles.editModalFoot}>
              <button className={styles.editCancelBtn} onClick={() => setIsAddingGuest(false)}>Batal</button>
              <button className={styles.editSaveBtn} onClick={handleAddGuest} disabled={isSaving}>
                {isSaving ? "Menyimpan..." : "Tambah Tamu"}
              </button>
            </div>
          </div>
        </div>
      )}
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
      {loadingMessage && (
        <div key={`load-${loadingMessage}`} className={styles.toastLoading}>
          <div className={styles.toastIcon}>
            <svg className={styles.spinner} viewBox="0 0 50 50">
              <circle cx="25" cy="25" r="20" fill="none" strokeWidth="5"></circle>
            </svg>
          </div>
          <span>{loadingMessage}</span>
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
  const [isMaximized, setIsMaximized] = useState(false);
  const [isCameraEnabled, setIsCameraEnabled] = useState(true);
  const [isVisible, setIsVisible] = useState(true);

  const toggleCamera = () => {
    setFacingMode(prev => (prev === "environment" ? "user" : "environment"));
  };

  const toggleMaximize = () => {
    setIsMaximized(!isMaximized);
  };

  const togglePower = () => {
    setIsCameraEnabled(!isCameraEnabled);
  };

  useEffect(() => {
    const handleVisibilityChange = () => setIsVisible(!document.hidden);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  useEffect(() => {
    if (scannedContact || !isCameraEnabled || !isVisible) return;

    let cancelled = false;
    const startDelay = setTimeout(() => {
      if (cancelled) return;

      const html5QrCode = new Html5Qrcode("reader");
      scannerRef.current = html5QrCode;
      const config = {
        fps: 20,
        qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
          const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
          const size = Math.floor(minEdge * 0.8);
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
            scanner.stop()
              .then(() => {
                try { scanner.clear(); } catch { }
              })
              .catch(() => { });
          } else {
            try { scanner.clear(); } catch { }
          }
        } catch { }
      }
      scannerRef.current = null;
    };
  }, [scannedContact, facingMode, isCameraEnabled, isVisible]);

  // Auto-dismiss after scan: 1s for regular, 3s for VIP
  useEffect(() => {
    if (!scannedContact) return;
    const isVip = scannedContact.priority?.toUpperCase() === "VIP" || scannedContact.priority?.toUpperCase() === "VVIP";
    const delay = isVip ? 5000 : 3000;
    const timer = setTimeout(() => {
      onReset();
    }, delay);
    return () => clearTimeout(timer);
  }, [scannedContact, onReset]);

  return (
    <div className={`${styles.scannerView} ${isMaximized ? styles.scannerViewMaximized : ""}`}>
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
            {(scannedContact.priority?.toUpperCase() === "VIP" || scannedContact.priority?.toUpperCase() === "VVIP") && (
              <div className={styles.resultVip}>TAMU {scannedContact.priority}</div>
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
            <div className={styles.scannerActions}>
              <button
                className={`${styles.scannerActionBtn} ${!isCameraEnabled ? styles.scannerActionBtnOff : ""}`}
                onClick={togglePower}
                title={isCameraEnabled ? "Matikan Kamera" : "Aktifkan Kamera"}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
                  <line x1="12" y1="2" x2="12" y2="12" />
                </svg>
              </button>
              <button
                className={styles.scannerActionBtn}
                onClick={toggleCamera}
                title="Ganti Kamera"
                disabled={!isCameraEnabled}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
              </button>
              <button
                className={styles.scannerActionBtn}
                onClick={toggleMaximize}
                title={isMaximized ? "Minimize" : "Maximize"}
              >
                {isMaximized ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" />
                    <line x1="14" y1="10" x2="21" y2="3" /><line x1="3" y1="21" x2="10" y2="14" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" />
                    <line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
                  </svg>
                )}
              </button>
            </div>
            <div
              id="reader"
              className={`${styles.reader} ${facingMode === "user" ? styles.readerMirrored : ""} ${!isCameraEnabled ? styles.readerDisabled : ""}`}
            ></div>
            {!isCameraEnabled && (
              <div className={styles.cameraOffPlaceholder}>
                <div className={styles.cameraOffIcon}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 1l22 22M21 21H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3m3-3h6l2 3h4a2 2 0 0 1 2 2v9.34m-7.72-2.06a4 4 0 1 1-5.56-5.56" />
                  </svg>
                </div>
                <span className={styles.cameraOffText}>Kamera Dinonaktifkan</span>
                <button className={styles.btnMini} onClick={togglePower} style={{ marginTop: 12 }}>Aktifkan</button>
              </div>
            )}

            <div className={styles.scannerOverlayFrame}>
              <div className={styles.scannerFrameCorners}></div>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}
