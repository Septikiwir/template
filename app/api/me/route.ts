import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth/session";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const context = await getSessionContext(request, {
      allowSuperadminTenantFromRequest: true,
    });

    return NextResponse.json({
      role: context.role,
      tenantId: context.tenantId ?? null,
      isSuperadmin: context.isSuperadmin,
    });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
