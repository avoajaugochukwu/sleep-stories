// Baserow REST client (no SQL). Auth via email/password -> JWT (cached, with
// re-auth on expiry/401). Used to flag a row's `video_processed` once footage
// is collected; the row id arrives via the ingest payload (n8n/Baserow).

const TOKEN_TTL_MS = 9 * 60 * 1000;
const PROCESSED_FIELD = process.env.BASEROW_PROCESSED_FIELD || "video_processed";

let cachedToken: { token: string; exp: number } | null = null;

function baseUrl(): string {
  return (process.env.BASE_ROW_URL || "").replace(/\/+$/, "");
}
function tableId(): string {
  return process.env.BASEROW_TABLE_ID || "";
}

async function authenticate(): Promise<string> {
  const res = await fetch(`${baseUrl()}/api/user/token-auth/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: process.env.BASEROW_EMAIL,
      password: process.env.BASEROW_PASSWORD,
    }),
  });
  if (!res.ok) throw new Error(`baserow auth failed (${res.status})`);
  const d = (await res.json()) as { access_token?: string; token?: string };
  const token = d.access_token || d.token;
  if (!token) throw new Error("baserow auth returned no token");
  return token;
}

async function getToken(force = false): Promise<string> {
  if (!force && cachedToken && cachedToken.exp > Date.now()) {
    return cachedToken.token;
  }
  const token = await authenticate();
  cachedToken = { token, exp: Date.now() + TOKEN_TTL_MS };
  return token;
}

async function api(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const token = await getToken();
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      ...(init.headers || {}),
      Authorization: `JWT ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (res.status === 401 && retry) {
    await getToken(true);
    return api(path, init, false);
  }
  return res;
}

/** Set the row's `video_processed` (so the team knows it's safe to delete). */
export async function markVideoProcessed(
  rowId: number,
  value: "done" | "failed" | "not_started" = "done"
): Promise<void> {
  const res = await api(
    `/api/database/rows/table/${tableId()}/${rowId}/?user_field_names=true`,
    { method: "PATCH", body: JSON.stringify({ [PROCESSED_FIELD]: value }) }
  );
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`baserow mark ${value} failed (${res.status}): ${t.slice(0, 160)}`);
  }
}
