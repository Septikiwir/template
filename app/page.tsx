"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import styles from "./page.module.css";

export default function Home() {
  const [nama, setNama] = useState("");
  const [nomor, setNomor] = useState("");
  const [link, setLink] = useState("");
  const [pesan, setPesan] = useState("");
  const [isBulkMode, setIsBulkMode] = useState(false);
  const [bulkInput, setBulkInput] = useState("");
  const [contacts, setContacts] = useState<{ nama: string; nomor: string; sent: boolean }[]>([]);

  // Load from localStorage on mount
  useEffect(() => {
    const savedLink = localStorage.getItem("wa_sender_link");
    const savedPesan = localStorage.getItem("wa_sender_pesan");
    if (savedLink) setLink(savedLink);
    if (savedPesan) setPesan(savedPesan);
  }, []);

  // Save to localStorage when changed
  useEffect(() => {
    if (link) localStorage.setItem("wa_sender_link", link);
  }, [link]);

  useEffect(() => {
    if (pesan) localStorage.setItem("wa_sender_pesan", pesan);
  }, [pesan]);

  const [touched, setTouched] = useState({ nama: false, nomor: false, link: false, pesan: false });
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const namaErr = touched.nama && !nama.trim();
  const nomorEmpty = touched.nomor && !nomor.trim();
  const nomorInvalid = touched.nomor && nomor.trim() !== "" && !/^\d+$/.test(nomor);
  const linkErr = touched.link && !link.trim();
  const pesanEmpty = touched.pesan && !pesan.trim();
  const pesanMissingNama = touched.pesan && pesan.trim() !== "" && !pesan.includes("{nama}");
  const pesanMissingLink = touched.pesan && pesan.trim() !== "" && !pesan.includes("{link}");
  const pesanErr = pesanEmpty || pesanMissingNama || pesanMissingLink;

  const isValidSingle =
    nama.trim() &&
    nomor.trim() &&
    /^\d+$/.test(nomor) &&
    link.trim() &&
    pesan.trim() &&
    pesan.includes("{nama}") &&
    pesan.includes("{link}");

  const isValidBulk =
    contacts.length > 0 &&
    link.trim() &&
    pesan.trim() &&
    pesan.includes("{nama}") &&
    pesan.includes("{link}");

  const isValid = isBulkMode ? isValidBulk : isValidSingle;

  const buildMessage = useCallback((customNama?: string, customLink?: string) => {
    if (!pesan.trim()) return "";
    const n = (customNama || nama).trim() || "{nama}";
    let l = (customLink || link).trim() || "{link}";

    // Handle link and "to=" parameter automatically
    if (n !== "{nama}" && l !== "{link}") {
      const nEncoded = encodeURIComponent(n);
      if (l.includes("to=")) {
        if (l.endsWith("to=")) l = l + nEncoded;
      } else {
        const separator = l.includes("?") ? "&" : "/?to=";
        const param = separator.includes("to=") ? "" : "to=";
        l = l + separator + param + nEncoded;
      }
    }

    return pesan.replace(/\{nama\}/g, n).replace(/\{link\}/g, l);
  }, [nama, pesan, link]);

  const previewMessage = buildMessage();

  const handleNomorChange = (value: string) => {
    let cleaned = value.replace(/[^\d]/g, "");
    if (cleaned.startsWith("0")) {
      cleaned = "62" + cleaned.slice(1);
    }
    setNomor(cleaned);
  };

  const sanitizeNomor = (val: string) => {
    let cleaned = val.replace(/[^\d]/g, "");
    if (cleaned.startsWith("0")) {
      cleaned = "62" + cleaned.slice(1);
    }
    return cleaned;
  };

  const parseBulkInput = () => {
    const lines = bulkInput.split("\n");
    const newContacts = lines
      .map((line) => {
        // Split by comma, semicolon, or tab
        const parts = line.split(/[,\t;]/);
        if (parts.length >= 2) {
          const n = parts[0].trim();
          const ph = sanitizeNomor(parts[1].trim());
          if (n && ph) return { nama: n, nomor: ph, sent: false };
        }
        return null;
      })
      .filter(Boolean) as { nama: string; nomor: string; sent: boolean }[];

    setContacts(newContacts);
  };

  const handleSendSingle = (contact: typeof contacts[0], index: number) => {
    const msg = buildMessage(contact.nama, link);
    const encoded = encodeURIComponent(msg);
    const url = `https://wa.me/${contact.nomor}?text=${encoded}`;
    window.open(url, "_blank");

    // Update sent status
    setContacts(prev => prev.map((c, i) => i === index ? { ...c, sent: true } : c));
  };

  const handleSubmit = () => {
    setTouched({ nama: true, nomor: true, link: true, pesan: true });
    if (!isValid) return;

    setLoading(true);
    setTimeout(() => {
      const msg = buildMessage();
      const encoded = encodeURIComponent(msg);
      const url = `https://wa.me/${nomor.trim()}?text=${encoded}`;
      window.open(url, "_blank");
      setLoading(false);
      setSent(true);
      setTimeout(() => setSent(false), 3000);
    }, 600);
  };

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = Math.max(el.scrollHeight, 120) + "px";
    }
  }, [pesan]);

  return (
    <>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.badge}>
          <span className={styles.badgeDot} />
          WhatsApp Message Sender
        </div>
        <h1 className={styles.title}>
          Kirim Pesan
          <br />
          <span className={styles.titleAccent}>Seketika.</span>
        </h1>
        <p className={styles.subtitle}>
          Tulis template sekali, kirim ke siapa saja — tanpa ribet.
        </p>
      </header>

      {/* Mode Toggle */}
      <div className={styles.card} style={{ maxWidth: '500px', marginBottom: '1rem', padding: '10px 10px 10px 10px' }}>
        <div className={styles.modeToggle}>
          <button
            className={`${styles.modeBtn} ${!isBulkMode ? styles.modeBtnActive : ""}`}
            onClick={() => setIsBulkMode(false)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            Single Send
          </button>
          <button
            className={`${styles.modeBtn} ${isBulkMode ? styles.modeBtnActive : ""}`}
            onClick={() => setIsBulkMode(true)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            Bulk Send
          </button>
        </div>
      </div>

      {/* Card */}
      <div className={styles.card}>
        {!isBulkMode ? (
          <>
            {/* Nama */}
            <div className={`${styles.field} ${namaErr ? styles.fieldError : ""}`}>
              <label htmlFor="nama" className={styles.label}>
                Nama Penerima <span className={styles.req}>*</span>
              </label>
              <div className={styles.inputWrap}>
                <input
                  id="nama"
                  type="text"
                  className={styles.input}
                  placeholder="Contoh: Budi Santoso"
                  autoComplete="off"
                  value={nama}
                  onChange={(e) => setNama(e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, nama: true }))}
                />
                <span className={styles.inputIcon}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="8" r="4" />
                    <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
                  </svg>
                </span>
              </div>
              {namaErr && (
                <div className={styles.hintError}>Nama penerima tidak boleh kosong.</div>
              )}
            </div>

            {/* Nomor */}
            <div className={`${styles.field} ${nomorEmpty || nomorInvalid ? styles.fieldError : ""}`}>
              <label htmlFor="nomor" className={styles.label}>
                Nomor WhatsApp <span className={styles.req}>*</span>
              </label>
              <div className={styles.inputWrap}>
                <input
                  id="nomor"
                  type="text"
                  className={styles.input}
                  placeholder="628xxxxxxxxx"
                  inputMode="numeric"
                  autoComplete="off"
                  value={nomor}
                  onChange={(e) => handleNomorChange(e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, nomor: true }))}
                />
                <span className={styles.inputIcon}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81a19.79 19.79 0 01-3.07-8.68A2 2 0 012 1h3a2 2 0 012 1.72c.12.96.36 1.9.72 2.81a2 2 0 01-.45 2.11L6.91 8.91a16 16 0 006.16 6.16l1.27-1.27a2 2 0 012.11-.45c.91.36 1.85.6 2.81.72A2 2 0 0122 16.92z" />
                  </svg>
                </span>
              </div>
              {!nomorEmpty && !nomorInvalid && (
                <div className={styles.hint}>
                  Otomatis konversi 0 → 62
                </div>
              )}
              {nomorEmpty && (
                <div className={styles.hintError}>Nomor WhatsApp tidak boleh kosong.</div>
              )}
              {nomorInvalid && (
                <div className={styles.hintError}>Nomor hanya boleh berisi angka.</div>
              )}
            </div>
          </>
        ) : (
          /* Bulk View */
          <div className={styles.field}>
            <label className={styles.label}>
              Input Data Massal <span className={styles.req}>*</span>
            </label>
            <textarea
              className={styles.textarea}
              placeholder={"Budi Santoso, +628xxxxxxxxx\nSiti Aminah, +628xxxxxxxx"}
              style={{ minHeight: '150px', paddingLeft: '14px' }}
              value={bulkInput}
              onChange={(e) => setBulkInput(e.target.value)}
            />
            <div className={styles.hint}>Format: Nama, Nomor HP (per baris)</div>
            <button
              className={`${styles.btn} ${styles.secondaryBtn}`}
              style={{ marginTop: '12px', padding: '10px' }}
              onClick={parseBulkInput}
            >
              Proses Daftar Kontak
            </button>

            {contacts.length > 0 && (
              <div style={{ marginTop: '2rem' }}>
                <div className={styles.bulkHeader}>
                  <span className={styles.bulkTitle}>Daftar Kontak ({contacts.length})</span>
                  <span className={styles.bulkStats}>
                    {contacts.filter(c => c.sent).length} / {contacts.length} Terkirim
                  </span>
                </div>
                <div className={styles.bulkList}>
                  {contacts.map((contact, index) => (
                    <div key={index} className={`${styles.contactRow} ${contact.sent ? styles.contactRowSent : ""}`}>
                      <div className={styles.contactInfo}>
                        <span className={styles.contactName}>{contact.nama}</span>
                        <span className={styles.contactNumber}>{contact.nomor}</span>
                      </div>
                      <div className={styles.rowActions}>
                        {contact.sent ? (
                          <span className={styles.sentBadge}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                            Sent
                          </span>
                        ) : (
                          <button className={styles.miniBtn} onClick={() => handleSendSingle(contact, index)}>
                            Kirim
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Link */}
        <div className={`${styles.field} ${linkErr ? styles.fieldError : ""}`}>
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
              onBlur={() => setTouched((t) => ({ ...t, link: true }))}
            />
            <span className={styles.inputIcon}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
              </svg>
            </span>
          </div>
          {linkErr && (
            <div className={styles.hintError}>Link tidak boleh kosong.</div>
          )}
        </div>

        {/* Template Pesan */}
        <div className={`${styles.field} ${pesanErr ? styles.fieldError : ""}`}>
          <label htmlFor="pesan" className={styles.label}>
            Template Pesan <span className={styles.req}>*</span>
          </label>
          <div className={styles.inputWrap}>
            <textarea
              ref={textareaRef}
              id="pesan"
              className={styles.textarea}
              placeholder={"Halo {nama}, kami mengundang Anda ke acara kami pada hari Sabtu.\n\nDitunggu kehadirannya!"}
              value={pesan}
              onChange={(e) => setPesan(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, pesan: true }))}
            />
            <span className={`${styles.inputIcon} ${styles.inputIconTextarea}`}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
              </svg>
            </span>
          </div>
          <div className={styles.hint}>
            Wajib gunakan <strong>{"{nama}"}</strong> dan <strong>{"{link}"}</strong> dalam template.
          </div>
          {pesanEmpty && (
            <div className={styles.hintError}>Template pesan tidak boleh kosong.</div>
          )}
          {pesanMissingNama && (
            <div className={styles.hintError}>Template harus mengandung <strong>{"{nama}"}</strong></div>
          )}
          {pesanMissingLink && (
            <div className={styles.hintError}>Template harus mengandung <strong>{"{link}"}</strong></div>
          )}
        </div>

        <hr className={styles.divider} />

        {/* Preview */}
        {previewMessage && (
          <div className={styles.previewSection}>
            <div className={styles.previewLabel}>Pratinjau Pesan</div>
            <div className={styles.previewBox}>
              {previewMessage}
            </div>
          </div>
        )}

        {/* Send Button */}
        {!isBulkMode && (
          <button
            id="btn-kirim"
            className={`${styles.btn} ${loading ? styles.btnLoading : ""} ${sent ? styles.btnSent : ""}`}
            disabled={!isValid || loading}
            onClick={handleSubmit}
          >
            {loading ? (
              <span className={styles.btnSpinner} />
            ) : sent ? (
              <>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span>Terkirim!</span>
              </>
            ) : (
              <>
                <span className={styles.btnIcon}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
                    <path d="M12 0C5.373 0 0 5.373 0 12c0 2.123.554 4.117 1.522 5.847L0 24l6.335-1.508A11.95 11.95 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.806 9.806 0 01-5.007-1.367l-.36-.213-3.724.977.993-3.63-.234-.372A9.808 9.808 0 012.182 12C2.182 6.57 6.57 2.182 12 2.182c5.43 0 9.818 4.388 9.818 9.818 0 5.43-4.388 9.818-9.818 9.818z" />
                  </svg>
                </span>
                <span>Kirim via WhatsApp</span>
              </>
            )}
          </button>
        )}
      </div>

      {/* Footer */}
      <p className={styles.footerNote}>
        Tidak ada data yang disimpan. Semua proses dilakukan{" "}
        <strong>langsung di browser Anda.</strong>
      </p>
    </>
  );
}
