import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

function request(headers: Record<string, string>) {
  return new NextRequest("http://127.0.0.1:3000/api/chat", {
    method: "POST",
    headers,
  });
}

describe("localhost request guard", () => {
  it("allows plain localhost requests", () => {
    for (const host of ["127.0.0.1:3000", "localhost:3000", "127.0.0.1"]) {
      expect(proxy(request({ host })).status).toBe(200);
    }
  });

  it("allows same-origin browser requests", () => {
    const res = proxy(
      request({
        host: "127.0.0.1:3000",
        origin: "http://127.0.0.1:3000",
        "sec-fetch-site": "same-origin",
      }),
    );
    expect(res.status).toBe(200);
  });

  it("rejects DNS-rebound hosts", () => {
    expect(proxy(request({ host: "attacker.example:3000" })).status).toBe(403);
  });

  it("rejects cross-site initiators", () => {
    expect(
      proxy(
        request({
          host: "127.0.0.1:3000",
          origin: "https://attacker.example",
        }),
      ).status,
    ).toBe(403);
    expect(
      proxy(
        request({ host: "127.0.0.1:3000", "sec-fetch-site": "cross-site" }),
      ).status,
    ).toBe(403);
  });

  it("rejects the null origin sandboxed iframes send", () => {
    expect(
      proxy(request({ host: "127.0.0.1:3000", origin: "null" })).status,
    ).toBe(403);
  });
});
