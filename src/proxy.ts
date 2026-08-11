import { NextRequest, NextResponse } from "next/server";

/**
 * This server drives a command-executing agent, so the localhost boundary has
 * to be real: without this check any web page the user has open could POST to
 * the API as a CORS "simple request" (no preflight), and DNS rebinding could
 * defeat the same-origin assumption entirely. Requests must carry a localhost
 * Host header, and when the browser identifies the initiator it must be this
 * app itself.
 */
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

function isLocalHost(value: string | null) {
  if (!value) return false;
  try {
    // The Host header is host[:port]; URL splits and normalizes it.
    return LOCAL_HOSTS.has(new URL(`http://${value}`).hostname);
  } catch {
    return false;
  }
}

const forbidden = (reason: string) =>
  new NextResponse(`Blocked: ${reason}\n`, { status: 403 });

export function proxy(request: NextRequest) {
  if (!isLocalHost(request.headers.get("host"))) {
    return forbidden("this server only answers to localhost");
  }

  // Same-origin requests either omit Origin or carry a localhost one. "null"
  // (sandboxed iframes, redirects) only ever comes from a foreign initiator.
  const origin = request.headers.get("origin");
  if (origin) {
    let originHost = null;
    try {
      originHost = new URL(origin).hostname;
    } catch {
      /* Unparseable origins ("null" included) are rejected below. */
    }
    if (!originHost || !LOCAL_HOSTS.has(originHost)) {
      return forbidden("cross-origin requests are not allowed");
    }
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site" || fetchSite === "same-site") {
    return forbidden("cross-site requests are not allowed");
  }

  return NextResponse.next();
}
