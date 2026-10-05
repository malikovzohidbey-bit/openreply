import { createHmac, randomBytes } from "crypto";

/**
 * Minimal X (Twitter) API v2 client using OAuth 1.0a user context.
 * Deliberately dependency-free: signing is ~30 lines and the app only needs
 * two calls (upload media, create post).
 */

export interface XCredentials {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessTokenSecret: string;
}

export class XApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "XApiError";
    this.status = status;
  }
}

const X_ENV = [
  "X_API_KEY",
  "X_API_SECRET",
  "X_ACCESS_TOKEN",
  "X_ACCESS_TOKEN_SECRET",
] as const;

export function getMissingXEnv(): string[] {
  return X_ENV.filter((name) => !process.env[name]);
}

export function getXCredentials(): XCredentials {
  const missing = getMissingXEnv();
  if (missing.length > 0) {
    throw new Error(`X API kalitlari yo'q: ${missing.join(", ")}`);
  }
  return {
    apiKey: process.env.X_API_KEY!,
    apiSecret: process.env.X_API_SECRET!,
    accessToken: process.env.X_ACCESS_TOKEN!,
    accessTokenSecret: process.env.X_ACCESS_TOKEN_SECRET!,
  };
}

// RFC 3986: encodeURIComponent leaves !'()* alone, OAuth 1.0a does not.
function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()
  );
}

/**
 * Authorization header for one request. `queryParams` must be exactly what
 * ends up in the URL's query string — they are part of the signature base.
 * JSON and multipart bodies are not signed, per the spec.
 */
export function buildOAuthHeader(
  method: string,
  url: string,
  creds: XCredentials,
  queryParams: Record<string, string> = {}
): string {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: creds.accessToken,
    oauth_version: "1.0",
  };

  const all = { ...queryParams, ...oauthParams };
  const paramString = Object.keys(all)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(all[k])}`)
    .join("&");

  const base = [
    method.toUpperCase(),
    percentEncode(url),
    percentEncode(paramString),
  ].join("&");
  const signingKey = `${percentEncode(creds.apiSecret)}&${percentEncode(creds.accessTokenSecret)}`;
  const signature = createHmac("sha1", signingKey).update(base).digest("base64");

  const header: Record<string, string> = { ...oauthParams, oauth_signature: signature };
  return (
    "OAuth " +
    Object.keys(header)
      .sort()
      .map((k) => `${percentEncode(k)}="${percentEncode(header[k])}"`)
      .join(", ")
  );
}

async function readError(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  try {
    const json = JSON.parse(text) as {
      detail?: string;
      title?: string;
      errors?: Array<{ message?: string }>;
      error?: string;
    };
    return (
      json.detail ??
      json.errors?.[0]?.message ??
      json.title ??
      json.error ??
      text ??
      `HTTP ${response.status}`
    );
  } catch {
    return text || `HTTP ${response.status}`;
  }
}

/**
 * Uploads one image/GIF and returns its media id. Tries the v2 endpoint
 * first; older apps that only have v1.1 media access fall back to it.
 */
export async function uploadMedia(
  creds: XCredentials,
  bytes: Buffer,
  mimeType: string
): Promise<string> {
  const category = mimeType === "image/gif" ? "tweet_gif" : "tweet_image";

  const v2Url = "https://api.x.com/2/media/upload";
  const v2Form = new FormData();
  v2Form.set("media", new Blob([new Uint8Array(bytes)], { type: mimeType }), "media");
  v2Form.set("media_category", category);
  v2Form.set("media_type", mimeType);

  const v2 = await fetch(v2Url, {
    method: "POST",
    headers: { Authorization: buildOAuthHeader("POST", v2Url, creds) },
    body: v2Form,
  });
  if (v2.ok) {
    const json = (await v2.json()) as { data?: { id?: string }; id?: string };
    const id = json.data?.id ?? json.id;
    if (id) return id;
  } else if (v2.status !== 404 && v2.status !== 403) {
    throw new XApiError(`Media yuklash xatosi: ${await readError(v2)}`, v2.status);
  }

  const v1Url = "https://upload.twitter.com/1.1/media/upload.json";
  const v1Form = new FormData();
  v1Form.set("media", new Blob([new Uint8Array(bytes)], { type: mimeType }), "media");
  v1Form.set("media_category", category);

  const v1 = await fetch(v1Url, {
    method: "POST",
    headers: { Authorization: buildOAuthHeader("POST", v1Url, creds) },
    body: v1Form,
  });
  if (!v1.ok) {
    throw new XApiError(`Media yuklash xatosi: ${await readError(v1)}`, v1.status);
  }
  const json = (await v1.json()) as { media_id_string?: string };
  if (!json.media_id_string) {
    throw new XApiError("Media yuklash javobida id yo'q", 502);
  }
  return json.media_id_string;
}

export async function createPost(
  creds: XCredentials,
  text: string,
  mediaIds: string[] = []
): Promise<{ id: string }> {
  const url = "https://api.x.com/2/tweets";
  const body: { text: string; media?: { media_ids: string[] } } = { text };
  if (mediaIds.length > 0) body.media = { media_ids: mediaIds };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: buildOAuthHeader("POST", url, creds),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new XApiError(await readError(response), response.status);
  }
  const json = (await response.json()) as { data?: { id?: string } };
  if (!json.data?.id) {
    throw new XApiError("X javobida post id yo'q", 502);
  }
  return { id: json.data.id };
}
