export type Role = "superadmin" | "admin" | "user";

export const roleHome: Record<Role, string> = {
  user: "/dashboard",
  admin: "/admin",
  superadmin: "/superadmin",
};
