"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { roleHome, type Role } from "@/lib/rbac/types";

type RoleGuardProps = {
  allowed: Role[];
  children: React.ReactNode;
};

export default function RoleGuard({ allowed, children }: RoleGuardProps) {
  const router = useRouter();
  const [status, setStatus] = useState<"checking" | "allowed">("checking");

  useEffect(() => {
    let active = true;

    const verifyRole = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const session = data.session;

        if (!session) {
          if (active) {
            router.replace("/dashboard");
          }
          return;
        }

        const response = await fetch("/api/me", {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        });

        if (!response.ok) {
          if (active) {
            router.replace("/dashboard");
          }
          return;
        }

        const payload = (await response.json()) as { role: Role };

        if (!allowed.includes(payload.role)) {
          if (active) {
            router.replace(roleHome[payload.role] ?? "/dashboard");
          }
          return;
        }

        if (active) {
          setStatus("allowed");
        }
      } catch {
        if (active) {
          router.replace("/dashboard");
        }
      }
    };

    verifyRole();

    return () => {
      active = false;
    };
  }, [allowed, router]);

  if (status !== "allowed") {
    return <div style={{ padding: "48px", textAlign: "center" }}>Memuat...</div>;
  }

  return <>{children}</>;
}
