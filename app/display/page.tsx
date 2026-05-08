"use client";

import { useEffect, useState, useRef } from "react";
import { supabase } from "@/lib/supabase";
import styles from "./page.module.css";

type GuestInfo = {
  name: string;
  category: string;
  priority: string;
};

type DisplaySettings = {
  welcomeText: string;
  bgColor: string;
  bgType: string;
  bgUrl: string;
  fontColor: string;
  showVipBar: boolean;
};

export default function DisplayPage() {
  const [guest, setGuest] = useState<GuestInfo | null>(null);
  const [settings, setSettings] = useState<DisplaySettings>({
    welcomeText: "SELAMAT DATANG",
    bgColor: "#e7d8a1",
    bgType: "color",
    bgUrl: "",
    fontColor: "#333333",
    showVipBar: true
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const channelRef = useRef<any>(null);

  useEffect(() => {
    async function init() {
      try {
        // 1. Get Session & Tenant Info
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

        // 2. Fetch Last Checked-in Guest & Settings
        const [guestRes, settingsRes] = await Promise.all([
          supabase
            .from("contacts")
            .select("nama, kategori, priority")
            .eq("tenant_id", tenantId)
            .eq("is_present", true)
            .order("present_at", { ascending: false })
            .limit(1)
            .single(),
          fetch("/api/settings", {
            headers: { Authorization: `Bearer ${session.access_token}` },
          })
        ]);

        if (guestRes.data) {
          setGuest({
            name: guestRes.data.nama,
            category: guestRes.data.kategori,
            priority: guestRes.data.priority,
          });
        }

        if (settingsRes.ok) {
          const sData = await settingsRes.json();
          if (sData.settings) {
            setSettings({
              welcomeText: sData.settings.display_welcome_text || "SELAMAT DATANG",
              bgColor: sData.settings.display_bg_color || "#e7d8a1",
              bgType: sData.settings.display_bg_type || "color",
              bgUrl: sData.settings.display_bg_url || "",
              fontColor: sData.settings.display_font_color || "#333333",
              showVipBar: sData.settings.display_show_vip_bar !== undefined ? sData.settings.display_show_vip_bar : true
            });
          }
        }

        // 3. Subscribe to Realtime Channel
        const channelId = `sync:${tenantId}`;
        const channel = supabase.channel(channelId);
        channelRef.current = channel;

        channel
          // Listener 1: Broadcast (Faster, instant)
          .on("broadcast", { event: "sync-data" }, (payload) => {
            console.log("[DISPLAY] Broadcast received:", payload);
            const { type, action, guest: guestPayload, data: settingsPayload } = payload.payload;
            
            if (type === "CONTACTS_UPDATED" && (action === "checkin" || action === "mutation") && guestPayload && guestPayload.is_present) {
              setGuest({
                name: guestPayload.name,
                category: guestPayload.kategori || guestPayload.category,
                priority: guestPayload.priority,
              });
            }

            if (type === "SETTINGS_UPDATED" && settingsPayload) {
              setSettings({
                welcomeText: settingsPayload.display_welcome_text || "SELAMAT DATANG",
                bgColor: settingsPayload.display_bg_color || "#e7d8a1",
                bgType: settingsPayload.display_bg_type || "color",
                bgUrl: settingsPayload.display_bg_url || "",
                fontColor: settingsPayload.display_font_color || "#333333",
                showVipBar: settingsPayload.display_show_vip_bar !== undefined ? settingsPayload.display_show_vip_bar : true
              });
            }
          })
          // Listener 2: Postgres Changes (Reliable fallback)
          .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: "contacts",
              filter: `tenant_id=eq.${tenantId}`
            },
            (payload) => {
              console.log("[DISPLAY] DB Change received:", payload.eventType);
              const updated = payload.new as any;
              if (updated && updated.is_present) {
                // Hanya update jika ini adalah tamu yang baru hadir
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
              console.log("[DISPLAY] Subscribed to realtime channel:", channelId);
              setRealtimeStatus("connected");
            } else {
              setRealtimeStatus("error");
            }
          });

        setLoading(false);
      } catch (err: any) {
        console.error("[DISPLAY] Init Error:", err);
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

  const [realtimeStatus, setRealtimeStatus] = useState<"connecting" | "connected" | "error">("connecting");

  if (loading) {
    return <div className={styles.statusContainer}>Memuat konfigurasi display...</div>;
  }

  if (error) {
    return <div className={styles.statusContainer}>{error}</div>;
  }

  return (
    <div className={styles.body} style={{ backgroundColor: settings.bgColor }}>
      {/* Background Media Container */}
      <div className={styles.bgContainer}>
        {settings.bgType === 'image' && settings.bgUrl && (
          <img src={settings.bgUrl} className={styles.bgMedia} alt="Background" />
        )}
        {settings.bgType === 'video' && settings.bgUrl && (
          <video 
            src={settings.bgUrl} 
            className={styles.bgMedia} 
            autoPlay 
            muted 
            loop 
            playsInline 
          />
        )}
        
        {/* Overlay always exists but changes opacity based on type */}
        <div 
          className={styles.overlay} 
          style={{ opacity: settings.bgType === 'color' ? 0 : 1 }}
        ></div>
      </div>

      {/* Live Indicator */}
      <div className={styles.liveBadge}>
        <div className={`${styles.dot} ${styles[realtimeStatus]}`}></div>
        {realtimeStatus === "connected" ? "LIVE" : realtimeStatus === "connecting" ? "CONNECTING" : "OFFLINE"}
      </div>

      <div className={styles.container} key={guest?.name || "idle"} style={{ color: settings.fontColor }}>
        <div className={styles.welcome} style={{ color: settings.fontColor }}>{settings.welcomeText}</div>
        <div className={styles.name} style={{ color: settings.fontColor }}>
          {guest ? (
            <>
              {guest.name.toUpperCase()}
              {guest.category && guest.category !== "-" && (
                <>
                  <br />
                  <span className={styles.category}>({guest.category.toUpperCase()})</span>
                </>
              )}
            </>
          ) : (
            "MENUNGGU TAMU..."
          )}
        </div>
      </div>

      {settings.showVipBar && (
        <div 
          key={guest?.name ? `${guest.name}-bar` : "idle-bar"}
          className={`${styles.vip} ${guest?.priority?.toUpperCase() === "REGULER" ? styles.reguler : ""}`}
        >
          {guest 
            ? (guest.priority?.toUpperCase() === "REGULER" ? "TAMU UNDANGAN" : `TAMU ${guest.priority.toUpperCase()}`)
            : "READY TO SCAN"
          }
        </div>
      )}
    </div>
  );
}
