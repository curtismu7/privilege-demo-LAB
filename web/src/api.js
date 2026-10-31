// One fetch wrapper for the app's own API (same origin, cookie session). Returns { ok, status, data }; never throws on a
// non-2xx answer, because deny (403) and hold (202) are normal results here. Nothing is logged.
export async function api(path, { method = "GET", body } = {}) {
  try {
    const res = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data = null;
    try { data = await res.json(); } catch { /* empty body */ }
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: "network" } };
  }
}

export const PERSONAS = {
  mark: { name: "Mark", role: "Traveler" },
  mary: { name: "Mary", role: "Analyst" },
  priya: { name: "Priya", role: "Approver, travel-agents lead" },
  dana: { name: "Dana", role: "Admin" },
};
