"use client";

import { useEffect, useState, useRef } from "react";
import { supabase } from "@/lib/supabase";
import styles from "./page.module.css";

type GuestInfo = {
  name: string;
  category: string;
  priority: string;
};

export default function DisplayPage1() {
  const [guest, setGuest] = useState<GuestInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [realtimeStatus, setRealtimeStatus] = useState<"connecting" | "connected" | "error">("connecting");
  const channelRef = useRef<any>(null);

  useEffect(() => {
    async function init() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          setError("Silakan login terlebih dahulu untuk menggunakan halaman display.");
          setLoading(false);
          return;
        }

        const meRes = await fetch("/api/me", {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!meRes.ok) throw new Error("Gagal memuat informasi sesi.");
        const meData = await meRes.json();
        const tenantId = meData.tenantId || session.user.id;

        // Fetch Last Checked-in Guest
        const { data: guestData } = await supabase
          .from("contacts")
          .select("nama, kategori, priority")
          .eq("tenant_id", tenantId)
          .eq("is_present", true)
          .order("present_at", { ascending: false })
          .limit(1)
          .single();

        if (guestData) {
          setGuest({
            name: guestData.nama,
            category: guestData.kategori,
            priority: guestData.priority,
          });
        }

        // Subscribe to Realtime Channel
        const channelId = `sync:${tenantId}`;
        const channel = supabase.channel(channelId);
        channelRef.current = channel;

        channel
          .on("broadcast", { event: "sync-data" }, (payload) => {
            console.log("[DISPLAY1] Broadcast received:", payload);
            const { type, action, guest: guestPayload } = payload.payload;
            
            if (type === "CONTACTS_UPDATED" && (action === "checkin" || action === "mutation") && guestPayload && guestPayload.is_present) {
              setGuest({
                name: guestPayload.name,
                category: guestPayload.kategori || guestPayload.category,
                priority: guestPayload.priority,
              });
            }
          })
          .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: "contacts",
              filter: `tenant_id=eq.${tenantId}`
            },
            (payload) => {
              const updated = payload.new as any;
              if (updated && updated.is_present) {
                setGuest({
                  name: updated.nama,
                  category: updated.kategori,
                  priority: updated.priority,
                });
              }
            }
          )
          .subscribe((status) => {
            if (status === "SUBSCRIBED") {
              setRealtimeStatus("connected");
            } else {
              setRealtimeStatus("error");
            }
          });

        setLoading(false);
      } catch (err: any) {
        console.error("[DISPLAY1] Init Error:", err);
        setError(err.message);
        setLoading(false);
      }
    }

    init();

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, []);

  if (loading) {
    return <div className={styles.statusContainer}>Memuat konfigurasi display...</div>;
  }

  if (error) {
    return <div className={styles.statusContainer}>{error}</div>;
  }

  return (
    <div className={styles.body}>
      {/* Connection Indicator */}
      <div className={styles.liveBadge}>
        <div className={`${styles.dot} ${styles[realtimeStatus]}`}></div>
        {realtimeStatus.toUpperCase()}
      </div>

      {/* TOP SECTION: Background Photo and Main Welcome */}
      <div className={styles.topSection}>
        <img
          src="/3 copy.jpg"
          alt="Background"
          className={styles.bgPhoto}
        />
        
        <div className={styles.topLogos}>
          {/* Nimantra Logo removed as requested */}
          {/* Circular FH Logo - using 5.svg as requested */}
          <img src="/5.svg" alt="FH Logo" className={styles.logoRight} />
        </div>

        <main className={styles.mainContent}>
          <p className={styles.welcomeText}>Terima Kasih Sudah Datang ,</p>
          <div key={guest?.name || "idle"} className={styles.guestNameWrapper}>
            <h1 className={styles.guestName}>
              {guest ? guest.name.toUpperCase() : "MENUNGGU TAMU..."}
            </h1>
          </div>
        </main>
      </div>

      {/* BOTTOM SECTION: White Footer with Event Details */}
      <footer className={styles.footerSection}>
        <div className={styles.footerDecorationLeft}>
          <img src="/5.svg" alt="Decoration" />
        </div>
        <div className={styles.footerDecorationRight}>
          <img src="/5.svg" alt="Decoration" />
        </div>

        <div className={styles.footerContent}>
          <div className={styles.partnerLogosLeft}>
            <div className={styles.eventDate}>
              17 . 05 . 2026
            </div>
            <img src="/6.svg" alt="Partner Logos Left" />
          </div>

          <div className={styles.eventTitle}>
            <span className={styles.theWeddingOf}>--- The Wedding of ---</span>
            <h2 className={styles.coupleNames}>Fizah & Hanif</h2>
          </div>

          <div className={styles.partnerLogos}>
             {/* Hashtags and Studio logos from 6.svg */}
            <img src="/6.svg" alt="Partner Logos" />
          </div>
        </div>
      </footer>
    </div>
  );
}
