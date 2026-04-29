import RoleGuard from "@/components/role-guard";
import styles from "./page.module.css";

export default function AdminPage() {
  return (
    <RoleGuard allowed={["admin"]}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Tenant Control</p>
            <h1 className={styles.title}>Admin Dashboard</h1>
            <p className={styles.subtitle}>
              Manage your tenant users, settings, and operational data.
            </p>
          </div>
          <div className={styles.badge}>Admin</div>
        </header>

        <main className={styles.grid}>
          <section className={styles.card}>
            <h2 className={styles.cardTitle}>Users</h2>
            <p className={styles.cardText}>
              Invite teammates, set roles, and manage access.
            </p>
            <button className={styles.primary}>Manage Users</button>
          </section>

          <section className={styles.card}>
            <h2 className={styles.cardTitle}>Billing</h2>
            <p className={styles.cardText}>
              Review plan limits, invoices, and upgrade options.
            </p>
            <button className={styles.secondary}>View Billing</button>
          </section>

          <section className={styles.card}>
            <h2 className={styles.cardTitle}>Data</h2>
            <p className={styles.cardText}>
              Monitor tenant activity and recent changes.
            </p>
            <button className={styles.secondary}>Open Reports</button>
          </section>
        </main>

        <section className={styles.panel}>
          <div>
            <h3 className={styles.panelTitle}>Quick Actions</h3>
            <p className={styles.panelText}>
              Common tenant tasks are centralized here for speed.
            </p>
          </div>
          <div className={styles.panelActions}>
            <button className={styles.ghost}>Create Team</button>
            <button className={styles.ghost}>Export Data</button>
            <button className={styles.primary}>Add User</button>
          </div>
        </section>
      </div>
    </RoleGuard>
  );
}
