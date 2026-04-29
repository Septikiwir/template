// Quick API Test Helper
// Use in browser console after login to test endpoints programmatically

async function getSessionToken() {
  const { data } = await window.__supabase.auth.getSession();
  return data.session?.access_token;
}

async function apiCall(method, path, data = null, headers = {}) {
  const token = await getSessionToken();
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...headers,
    },
  };
  if (data) opts.body = JSON.stringify(data);

  const res = await fetch(path, opts);
  const json = await res.json();
  console.log(`${method} ${path}:`, { status: res.status, data: json });
  return json;
}

// Test Suite
const tests = {
  // Get current user session info
  async testMe() {
    return apiCall("GET", "/api/me");
  },

  // Get contacts for default tenant
  async testGetContacts() {
    return apiCall("GET", "/api/contacts");
  },

  // Get contacts for specific tenant (admin only)
  async testGetContactsForTenant(tenantId) {
    return apiCall("GET", "/api/contacts", null, {
      "x-tenant-id": tenantId,
    });
  },

  // Add a test contact
  async testAddContact(name, phone) {
    return apiCall("POST", "/api/contacts", {
      contacts: [
        {
          nama: name,
          nomor: phone,
          priority: "Reguler",
          kategori: "Testing",
          added_via: "manual",
        },
      ],
    });
  },

  // Check in a contact
  async testCheckIn(contactId, token) {
    return apiCall("POST", "/api/contacts", {
      action: "checkin",
      contacts: [
        {
          id: contactId,
          is_present: true,
          present_at: new Date().toISOString(),
        },
      ],
    });
  },

  // Delete a contact
  async testDeleteContact(contactId) {
    return apiCall("DELETE", `/api/contacts?id=${contactId}`);
  },
};

// Example usage:
// await tests.testMe()
// await tests.testGetContacts()
// await tests.testAddContact("Test User", "628111111111")
