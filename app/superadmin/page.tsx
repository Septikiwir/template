"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import RoleGuard from "@/components/role-guard";
import { supabase } from "@/lib/supabase";
import styles from "./page.module.css";

type TenantRow = {
  id: string;
  name: string;
  plan: string;
  created_at: string;
};

type SuspensionRow = {
  id: number;
  tenant_name: string;
  target_type: string;
  target_label: string;
  reason: string;
  status: string;
  suspended_at: string;
  restored_at: string | null;
  restored_by_label: string | null;
};

type OverrideRow = {
  id: number;
  tenant_name: string;
  target_label: string;
  reason: string;
  expires_at: string;
  granted_by_label: string;
  active: boolean;
  granted_at: string;
  revoked_at: string | null;
};

type AuditLogRow = {
  id: number;
  tenant_name: string | null;
  actor_label: string;
  action: string;
  details: string;
  created_at: string;
};

type DashboardData = {
  summary: {
    totalTenants: number;
    activeUsers: number;
    contacts: number;
    suspendedTenants: number;
    activeOverrides: number;
  };
  planCounts: Record<string, number>;
  recentTenants: TenantRow[];
  suspensions: SuspensionRow[];
  overrides: OverrideRow[];
  auditLogs: AuditLogRow[];
};

type CreateTenantForm = {
  name: string;
  plan: string;
  adminUsername: string;
  adminPassword: string;
};

type OverrideForm = {
  tenantId: string;
  targetLabel: string;
  reason: string;
  expiresAt: string;
};

const initialTenantForm: CreateTenantForm = {
  name: "",
  plan: "free",
  adminUsername: "",
  adminPassword: "",
};

const initialOverrideForm: OverrideForm = {
  tenantId: "",
  targetLabel: "",
  reason: "",
  expiresAt: "",
};

const formatDateTime = (value: string | null | undefined) => {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
};

const formatNumber = (value: number) => new Intl.NumberFormat("id-ID").format(value);

export default function SuperadminPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [tenantForm, setTenantForm] = useState<CreateTenantForm>(initialTenantForm);
  const [overrideForm, setOverrideForm] = useState<OverrideForm>(initialOverrideForm);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    window.location.href = "/";
  };

  const loadDashboard = async () => {
    setLoading(true);
    setError("");

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const session = sessionData.session;

      if (!session) {
        throw new Error("Session not found.");
      }

      const response = await fetch("/api/superadmin", {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "Failed to load superadmin dashboard.");
      }

      setData((await response.json()) as DashboardData);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load dashboard.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, []);

  const tenantOptions = useMemo(
    () => data?.recentTenants ?? [],
    [data?.recentTenants]
  );

  const scrollToSection = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const submitTenant = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    setError("");

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const session = sessionData.session;
      if (!session) throw new Error("Session not found.");

      const response = await fetch("/api/superadmin", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          action: "create-tenant",
          name: tenantForm.name,
          plan: tenantForm.plan,
          adminUsername: tenantForm.adminUsername,
          adminPassword: tenantForm.adminPassword,
        }),
      });

      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to create tenant.");
      }

      setMessage("Tenant berhasil dibuat dan audit log tersimpan.");
      setTenantForm(initialTenantForm);
      await loadDashboard();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to create tenant.");
    } finally {
      setSaving(false);
    }
  };

  const submitOverride = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    setError("");

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const session = sessionData.session;
      if (!session) throw new Error("Session not found.");

      const response = await fetch("/api/superadmin", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          action: "new-override",
          tenantId: overrideForm.tenantId,
          targetLabel: overrideForm.targetLabel,
          reason: overrideForm.reason,
          expiresAt: new Date(overrideForm.expiresAt).toISOString(),
        }),
      });

      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to create override.");
      }

      setMessage("Override sementara berhasil dibuat.");
      setOverrideForm(initialOverrideForm);
      await loadDashboard();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to create override.");
    } finally {
      setSaving(false);
    }
  };

  const restoreSuspension = async (id: number) => {
    setSaving(true);
    setMessage("");
    setError("");

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const session = sessionData.session;
      if (!session) throw new Error("Session not found.");

      const response = await fetch("/api/superadmin", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ action: "restore-suspension", suspensionId: id }),
      });

      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to restore suspension.");
      }

      setMessage("Suspension berhasil dipulihkan.");
      await loadDashboard();
    } catch (restoreError) {
      setError(restoreError instanceof Error ? restoreError.message : "Failed to restore suspension.");
    } finally {
      setSaving(false);
    }
  };

  const planEntries = Object.entries(data?.planCounts ?? {});

  return (
    <RoleGuard allowed={["superadmin"]}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>System Control</p>
            <h1 className={styles.title}>Superadmin Console</h1>
            <p className={styles.subtitle}>
              Global visibility across tenants, plans, and system activity. Semua angka di halaman ini
              diambil langsung dari database.
            </p>
            <div className={styles.quickActions}>
              <button className={styles.primary} type="button" onClick={() => scrollToSection("create-tenant")}>
                Create Tenant
              </button>
              <button className={styles.secondary} type="button" onClick={() => scrollToSection("review-suspensions")}>
                Review Suspensions
              </button>
              <button className={styles.primaryDark} type="button" onClick={() => scrollToSection("override-log")}>
                Open Override Log
              </button>
              <button className={styles.ghostDark} type="button" onClick={() => scrollToSection("new-override")}>
                New Override
              </button>
              <button className={styles.secondary} type="button" onClick={() => scrollToSection("analytics")}>
                Open Analytics
              </button>
              <button className={styles.ghost} type="button" onClick={handleLogout} style={{ color: "#ef4444" }}>
                Logout
              </button>
            </div>
          </div>
          <div className={styles.statusPill}>
            <span className={styles.statusDot} />
            {data ? `${formatNumber(data.summary.totalTenants)} tenants monitored` : "Loading..."}
          </div>
        </header>

        <section className={styles.kpiGrid}>
          <article className={styles.kpiCard}>
            <h2 className={styles.kpiLabel}>Total Tenants</h2>
            <p className={styles.kpiValue}>{formatNumber(data?.summary.totalTenants ?? 0)}</p>
            <p className={styles.kpiMeta}>Tenant/workspace yang terdaftar</p>
          </article>
          <article className={styles.kpiCard}>
            <h2 className={styles.kpiLabel}>Active Users</h2>
            <p className={styles.kpiValue}>{formatNumber(data?.summary.activeUsers ?? 0)}</p>
            <p className={styles.kpiMeta}>Users yang tersimpan di app_users</p>
          </article>
          <article className={styles.kpiCard}>
            <h2 className={styles.kpiLabel}>Suspensions</h2>
            <p className={styles.kpiValue}>{formatNumber(data?.summary.suspendedTenants ?? 0)}</p>
            <p className={styles.kpiMeta}>Tenant/user yang sedang disuspend</p>
          </article>
          <article className={styles.kpiCard}>
            <h2 className={styles.kpiLabel}>Active Overrides</h2>
            <p className={styles.kpiValue}>{formatNumber(data?.summary.activeOverrides ?? 0)}</p>
            <p className={styles.kpiMeta}>Override akses sementara yang aktif</p>
          </article>
        </section>

        <section className={styles.split}>
          <article className={styles.panel} id="create-tenant">
            <h3 className={styles.panelTitle}>Create Tenant</h3>
            <p className={styles.panelText}>
              Membuat tenant, workspace, atau perusahaan baru. Jika email admin sudah ada di app_users,
              sistem akan mengaitkannya sebagai admin tenant.
            </p>
            <form className={styles.formGrid} onSubmit={submitTenant}>
              <label className={styles.field}>
                <span className={styles.label}>Tenant name</span>
                <input
                  className={styles.input}
                  value={tenantForm.name}
                  onChange={(event) => setTenantForm((prev) => ({ ...prev, name: event.target.value }))}
                  placeholder="PT Wedding Nusantara"
                  required
                />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>Plan</span>
                <select
                  className={styles.input}
                  value={tenantForm.plan}
                  onChange={(event) => setTenantForm((prev) => ({ ...prev, plan: event.target.value }))}
                >
                  <option value="free">free</option>
                  <option value="pro">pro</option>
                  <option value="enterprise">enterprise</option>
                </select>
              </label>
              <label className={styles.field}>
                <span className={styles.label}>Admin username</span>
                <input
                  className={styles.input}
                  value={tenantForm.adminUsername}
                  onChange={(event) =>
                    setTenantForm((prev) => ({ ...prev, adminUsername: event.target.value }))
                  }
                  placeholder="client-admin"
                  required
                />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>Admin password</span>
                <input
                  className={styles.input}
                  type="password"
                  value={tenantForm.adminPassword}
                  onChange={(event) =>
                    setTenantForm((prev) => ({ ...prev, adminPassword: event.target.value }))
                  }
                  placeholder="Minimum 8 characters"
                  required
                />
              </label>
              <div className={styles.fieldWide}>
                <button className={styles.primary} type="submit" disabled={saving}>
                  Create Tenant
                </button>
                <p className={styles.helper}>
                  Login admin akan dibuat sebagai username@wedding.com dan langsung di-assign ke tenant ini.
                </p>
              </div>
            </form>
          </article>

          <article className={styles.panelDark} id="new-override">
            <h3 className={styles.panelTitle}>New Override</h3>
            <p className={styles.panelText}>
              Membuat akses sementara untuk support, troubleshooting, atau compliance investigation.
            </p>
            <form className={styles.formGridDark} onSubmit={submitOverride}>
              <label className={styles.fieldDark}>
                <span className={styles.labelDark}>Tenant</span>
                <select
                  className={styles.inputDark}
                  value={overrideForm.tenantId}
                  onChange={(event) =>
                    setOverrideForm((prev) => ({ ...prev, tenantId: event.target.value }))
                  }
                  required
                >
                  <option value="">Select tenant</option>
                  {tenantOptions.map((tenant) => (
                    <option key={tenant.id} value={tenant.id}>
                      {tenant.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.fieldDark}>
                <span className={styles.labelDark}>Target label</span>
                <input
                  className={styles.inputDark}
                  value={overrideForm.targetLabel}
                  onChange={(event) =>
                    setOverrideForm((prev) => ({ ...prev, targetLabel: event.target.value }))
                  }
                  placeholder="Support Engineer Demo"
                  required
                />
              </label>
              <label className={styles.fieldDark}>
                <span className={styles.labelDark}>Reason</span>
                <textarea
                  className={styles.textareaDark}
                  value={overrideForm.reason}
                  onChange={(event) =>
                    setOverrideForm((prev) => ({ ...prev, reason: event.target.value }))
                  }
                  placeholder="Allow support access for 2 hours"
                  required
                />
              </label>
              <label className={styles.fieldDark}>
                <span className={styles.labelDark}>Expiry</span>
                <input
                  className={styles.inputDark}
                  type="datetime-local"
                  value={overrideForm.expiresAt}
                  onChange={(event) =>
                    setOverrideForm((prev) => ({ ...prev, expiresAt: event.target.value }))
                  }
                  required
                />
              </label>
              <div className={styles.fieldWideDark}>
                <button className={styles.primaryDark} type="submit" disabled={saving}>
                  New Override
                </button>
                <p className={styles.helperDark}>
                  Override dicatat ke audit log dan tampil di daftar global.
                </p>
              </div>
            </form>
          </article>
        </section>

        <section className={styles.split}>
          <article className={styles.panel} id="review-suspensions">
            <div className={styles.panelHeader}>
              <div>
                <h3 className={styles.panelTitle}>Review Suspensions</h3>
                <p className={styles.panelText}>
                  Tenant atau user yang sedang disuspend dan bisa dipulihkan oleh superadmin.
                </p>
              </div>
              <button className={styles.secondary} type="button" onClick={() => scrollToSection("analytics")}> 
                Open Analytics
              </button>
            </div>

            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Target</th>
                    <th>Reason</th>
                    <th>Status</th>
                    <th>When</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.suspensions.length ? (
                    data.suspensions.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <strong>{item.target_label}</strong>
                          <div className={styles.muted}>{item.tenant_name}</div>
                        </td>
                        <td>{item.reason}</td>
                        <td>
                          <span
                            className={
                              item.status === "suspended" ? styles.pillWarn : styles.pillSuccess
                            }
                          >
                            {item.status}
                          </span>
                        </td>
                        <td>{formatDateTime(item.suspended_at)}</td>
                        <td>
                          {item.status === "suspended" ? (
                            <button
                              className={styles.rowAction}
                              type="button"
                              disabled={saving}
                              onClick={() => restoreSuspension(item.id)}
                            >
                              Restore
                            </button>
                          ) : (
                            <span className={styles.pillMuted}>Restored by {item.restored_by_label ?? "-"}</span>
                          )}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className={styles.emptyState}>
                        No suspension records yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </article>

          <article className={styles.panelDark} id="override-log">
            <div className={styles.panelHeaderDark}>
              <div>
                <h3 className={styles.panelTitle}>Open Override Log</h3>
                <p className={styles.panelText}>
                  Audit trail untuk setiap permission bypass, escalation, dan temporary access.
                </p>
              </div>
              <button className={styles.ghostDark} type="button" onClick={() => scrollToSection("create-tenant")}>
                Create Tenant
              </button>
            </div>

            <div className={styles.tableWrapDark}>
              <table className={styles.tableDark}>
                <thead>
                  <tr>
                    <th>Tenant</th>
                    <th>Target</th>
                    <th>Reason</th>
                    <th>Expires</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.overrides.length ? (
                    data.overrides.map((item) => (
                      <tr key={item.id}>
                        <td>{item.tenant_name}</td>
                        <td>{item.target_label}</td>
                        <td>{item.reason}</td>
                        <td>
                          <span className={item.active ? styles.pillLight : styles.pillMutedDark}>
                            {formatDateTime(item.expires_at)}
                          </span>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4} className={styles.emptyStateDark}>
                        No active overrides yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </article>
        </section>

        <section className={styles.footer} id="analytics">
          <div className={styles.footerCopy}>
            <h4 className={styles.footerTitle}>Open Analytics</h4>
            <p className={styles.footerText}>
              Global metrics untuk total tenant, active users, contacts, dan plan adoption.
            </p>
            <div className={styles.miniStats}>
              <div className={styles.miniStat}>
                <span className={styles.miniStatLabel}>Contacts</span>
                <strong className={styles.miniStatValue}>{formatNumber(data?.summary.contacts ?? 0)}</strong>
              </div>
              <div className={styles.miniStat}>
                <span className={styles.miniStatLabel}>Plans</span>
                <strong className={styles.miniStatValue}>{planEntries.length}</strong>
              </div>
              <div className={styles.miniStat}>
                <span className={styles.miniStatLabel}>Recent logs</span>
                <strong className={styles.miniStatValue}>{data?.auditLogs.length ?? 0}</strong>
              </div>
            </div>
          </div>
          <div className={styles.analyticsBox}>
            <h5 className={styles.analyticsTitle}>Plan Adoption</h5>
            {planEntries.length ? (
              <div className={styles.planList}>
                {planEntries.map(([plan, count]) => (
                  <div className={styles.planItem} key={plan}>
                    <span>{plan}</span>
                    <strong>{formatNumber(count)}</strong>
                  </div>
                ))}
              </div>
            ) : (
              <p className={styles.analyticsEmpty}>No tenant data yet.</p>
            )}
          </div>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <h3 className={styles.panelTitle}>Recent Tenant Activity</h3>
              <p className={styles.panelText}>Latest tenant records and audit trail from the database.</p>
            </div>
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Tenant</th>
                  <th>Plan</th>
                  <th>Created</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {data?.recentTenants.length ? (
                  data.recentTenants.map((tenant) => (
                    <tr key={tenant.id}>
                      <td>{tenant.name}</td>
                      <td>
                        <span className={styles.pill}>{tenant.plan}</span>
                      </td>
                      <td>{formatDateTime(tenant.created_at)}</td>
                      <td>
                        <button
                          className={styles.rowAction}
                          type="button"
                          onClick={() => setTenantForm({ name: tenant.name, plan: tenant.plan, adminUsername: "", adminPassword: "" })}
                        >
                          Reuse
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className={styles.emptyState}>
                      No tenants available.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className={styles.panelDark}>
          <div className={styles.panelHeaderDark}>
            <div>
              <h3 className={styles.panelTitle}>Global Audit Stream</h3>
              <p className={styles.panelText}>Who did what, on which tenant, and when it happened.</p>
            </div>
          </div>

          <div className={styles.tableWrapDark}>
            <table className={styles.tableDark}>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Actor</th>
                  <th>Tenant</th>
                  <th>Action</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {data?.auditLogs.length ? (
                  data.auditLogs.map((log) => (
                    <tr key={log.id}>
                      <td>{formatDateTime(log.created_at)}</td>
                      <td>{log.actor_label}</td>
                      <td>{log.tenant_name ?? "-"}</td>
                      <td>
                        <span className={styles.pillLight}>{log.action}</span>
                      </td>
                      <td>{log.details}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className={styles.emptyStateDark}>
                      No audit logs yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {(loading || error || message) && (
          <section className={styles.footerNotice}>
            <p className={styles.footerNoticeText}>
              {loading ? "Loading dashboard from database..." : error || message}
            </p>
            <button className={styles.secondary} type="button" onClick={loadDashboard}>
              Refresh Data
            </button>
          </section>
        )}
      </div>
    </RoleGuard>
  );
}
