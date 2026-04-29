const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function decodeJWT(token) {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));

    return JSON.parse(jsonPayload);
  } catch (e) {
    return null;
  }
}

console.log("--- KEY DIAGNOSTIC ---");
if (anonKey) {
  const payload = decodeJWT(anonKey);
  console.log("Anon Key Role:", payload?.role || "unknown");
} else {
  console.log("Anon Key: MISSING");
}

if (serviceKey) {
  const payload = decodeJWT(serviceKey);
  console.log("Service Role Key Role:", payload?.role || "unknown");
  if (payload?.role !== "service_role") {
    console.log("WARNING: SUPABASE_SERVICE_ROLE_KEY is NOT a service_role key!");
  }
} else {
  console.log("Service Role Key: MISSING");
}

if (anonKey && serviceKey && anonKey === serviceKey) {
  console.log("CRITICAL: Both keys are IDENTICAL.");
}
console.log("----------------------");
