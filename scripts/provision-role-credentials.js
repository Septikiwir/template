const fs = require("node:fs");
const path = require("node:path");
const { createClient } = require("@supabase/supabase-js");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }

    const equalsIndex = trimmed.indexOf("=");
    const key = trimmed.slice(0, equalsIndex).trim();
    const value = trimmed.slice(equalsIndex + 1).trim();

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(path.join(__dirname, "..", ".env.local"));

function getJwtRole(token) {
  const parts = token.split(".");
  if (parts.length < 2) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return typeof payload.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

const accounts = [
  {
    email: "superadmin@wedding.com",
    password: "SuperAdmin123!",
    fullName: "Super Admin",
    isSuperadmin: true,
    defaultTenantId: null,
    memberships: [],
  },
  {
    email: "admin@wedding.com",
    password: "Admin123!",
    fullName: "Admin Tenant",
    isSuperadmin: false,
    defaultTenantId: "22222222-2222-2222-2222-222222222222",
    memberships: [
      {
        tenantId: "22222222-2222-2222-2222-222222222222",
        role: "admin",
      },
    ],
  },
];

async function findUserByEmail(admin, email) {
  const { data, error } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });

  if (error) {
    throw error;
  }

  return data.users.find((user) => user.email === email) ?? null;
}

async function upsertAuthUser(admin, account) {
  const existingUser = await findUserByEmail(admin, account.email);

  if (existingUser) {
    const { error } = await admin.auth.admin.updateUserById(existingUser.id, {
      password: account.password,
      email_confirm: true,
      user_metadata: {
        full_name: account.fullName,
      },
    });

    if (error) {
      throw error;
    }

    return existingUser.id;
  }

  const { data, error } = await admin.auth.admin.createUser({
    email: account.email,
    password: account.password,
    email_confirm: true,
    user_metadata: {
      full_name: account.fullName,
    },
  });

  if (error) {
    throw error;
  }

  if (!data.user) {
    throw new Error(`Failed to create auth user for ${account.email}`);
  }

  return data.user.id;
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment/.env.local"
    );
  }

  const tokenRole = getJwtRole(serviceRoleKey);
  if (tokenRole !== "service_role") {
    throw new Error(
      `SUPABASE_SERVICE_ROLE_KEY must be a real service_role key. Current role: ${tokenRole ?? "invalid"}. ` +
        "Replace the value in .env.local with the service role key from Supabase Dashboard > Project Settings > API."
    );
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  for (const account of accounts) {
    const userId = await upsertAuthUser(admin, account);

    const { error: appUserError } = await admin
      .from("app_users")
      .upsert(
        {
          id: userId,
          email: account.email,
          full_name: account.fullName,
          default_tenant_id: account.defaultTenantId,
          is_superadmin: account.isSuperadmin,
        },
        { onConflict: "id" }
      );

    if (appUserError) {
      throw appUserError;
    }

    for (const membership of account.memberships) {
      const { error: membershipError } = await admin
        .from("tenant_memberships")
        .upsert(
          {
            tenant_id: membership.tenantId,
            user_id: userId,
            role: membership.role,
          },
          { onConflict: "tenant_id,user_id" }
        );

      if (membershipError) {
        throw membershipError;
      }
    }
  }

  console.log("Provisioned role credentials successfully.");
  console.log("superadmin@wedding.com / SuperAdmin123!");
  console.log("admin@wedding.com / Admin123!");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});