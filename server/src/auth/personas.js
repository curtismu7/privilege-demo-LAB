// The four demo personas. Groups follow the plan's mapping table; they are invented for the demo.
// The claims have the shape of a verified PingFederate access token (what mapClaims reads).
export const PERSONAS = {
  mark: { name: 'Mark', role: 'Traveler', claims: { sub: 'mark', groups: ['travel-agents'], scope: 'tools:invoke', client_id: 'privilege-demo-web' } },
  mary: { name: 'Mary', role: 'Analyst', claims: { sub: 'mary', groups: ['analysts'], scope: 'tools:invoke', client_id: 'privilege-demo-web' } },
  priya: { name: 'Priya', role: 'Approver, travel-agents lead', claims: { sub: 'priya', groups: ['travel-agents'], scope: 'tools:invoke', client_id: 'privilege-demo-web' } },
  dana: { name: 'Dana', role: 'Admin', admin: true, claims: { sub: 'dana', groups: ['admins'], scope: 'tools:invoke policy:admin', client_id: 'privilege-demo-web' } },
};

export const AGENT = { sub: 'dot' }; // Mark's personal agent; adds act.sub, which makes the call unattended

export const isAdmin = (claims) => Array.isArray(claims?.groups) && claims.groups.includes('admins');
