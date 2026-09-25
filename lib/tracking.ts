import { createHash } from "node:crypto";

import { decryptSecret, encryptSecret } from "./crypto.ts";

export interface TrackingToken {
  messageId: string;
  url: string;
}

function key() {
  const value = process.env.SESSION_SECRET;
  if (!value) throw new Error("SESSION_SECRET is required");
  return value;
}

export function createTrackingToken(value: TrackingToken) {
  return encryptSecret(key(), JSON.stringify({ m: value.messageId, u: value.url }));
}

export function readTrackingToken(token: string): TrackingToken | null {
  const plain = decryptSecret(key(), token);
  if (!plain) return null;
  try {
    const parsed = JSON.parse(plain) as { m?: unknown; u?: unknown };
    if (typeof parsed.m !== "string" || !/^[0-9a-f-]{36}$/i.test(parsed.m) || typeof parsed.u !== "string") return null;
    if (parsed.u) {
      const url = new URL(parsed.u);
      if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    }
    return { messageId: parsed.m, url: parsed.u };
  } catch {
    return null;
  }
}

export function targetHash(url: string) {
  return createHash("sha256").update(url).digest("hex");
}

function isUnsubscribe(url: string) {
  try {
    return /\/unsubscribe$/.test(new URL(url.replaceAll("&amp;", "&")).pathname);
  } catch {
    return false;
  }
}

export function applyTracking(
  rendered: { text: string; html: string },
  options: { baseUrl: string; messageId: string; open: boolean; click: boolean },
) {
  const base = options.baseUrl.replace(/\/$/, "");
  const trackedUrl = (raw: string) => {
    const url = raw.replaceAll("&amp;", "&");
    if (!options.click || isUnsubscribe(url)) return raw;
    return `${base}/api/track/click?token=${encodeURIComponent(createTrackingToken({ messageId: options.messageId, url }))}`;
  };
  const urls = /https?:\/\/[^\s<>"']+/g;
  const text = rendered.text.replace(urls, trackedUrl);
  let html = rendered.html.replace(urls, trackedUrl);
  if (options.open) {
    const token = encodeURIComponent(createTrackingToken({ messageId: options.messageId, url: "" }));
    html += `<img src="${base}/api/track/open?token=${token}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0">`;
  }
  return { text, html };
}
