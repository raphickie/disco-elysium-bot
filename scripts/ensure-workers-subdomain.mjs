#!/usr/bin/env node
// Bootstrap the account-wide workers.dev subdomain on the first CI deploy.
// Existing subdomains are never changed. Requires Workers Scripts Write.
const { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: accountId } = process.env;
if (!token || !accountId) throw new Error('Cloudflare credentials are missing');

const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/workers/subdomain`;
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

async function request(method, body) {
  const response = await fetch(endpoint, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json();
  return { status: response.status, ok: response.ok && payload.success === true, payload };
}

function errors(result) {
  return (result.payload.errors ?? []).map(e => `${e.code}: ${e.message}`).join('; ');
}

const existing = await request('GET');
if (existing.ok && existing.payload.result?.subdomain) {
  console.log('Using existing workers.dev subdomain:', existing.payload.result.subdomain);
  process.exit(0);
}

// Do not accidentally treat missing authorization or an API outage as an
// unregistered subdomain.
const detail = errors(existing);
const notConfigured = existing.status === 404
  || (existing.status === 400 && /workers.dev|subdomain|onboard/i.test(detail));
if (!notConfigured) {
  throw new Error(`Cannot inspect workers.dev subdomain (HTTP ${existing.status}): ${detail}`);
}

const names = [
  'raphickie-apps',
  `raphickie-apps-${accountId.replace(/[^a-f0-9]/gi, '').slice(0, 8)}`,
];
for (let i = 0; i < names.length; i++) {
  const name = names[i];
  const created = await request('PUT', { subdomain: name });
  if (created.ok && created.payload.result?.subdomain) {
    console.log('Registered workers.dev subdomain:', created.payload.result.subdomain);
    process.exit(0);
  }
  const detail = errors(created);
  const taken = created.status === 409 || /taken|already (in use|exists)|unavailable/i.test(detail);
  if (taken && i < names.length - 1) continue;
  throw new Error(`Cannot register workers.dev subdomain (HTTP ${created.status}): ${detail}`);
}
throw new Error('No available workers.dev subdomain name');
