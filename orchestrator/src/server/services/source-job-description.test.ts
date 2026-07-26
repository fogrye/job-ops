import type * as Undici from "undici";
import { Response } from "undici";
import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolve4: vi.fn(),
  resolve6: vi.fn(),
  cancel: vi.fn(),
  fetch: vi.fn(),
  agents: [] as Array<{
    instance: object;
    options: {
      connect: {
        lookup: (
          hostname: string,
          options: object,
          callback: (error: null, address: string, family: 4 | 6) => void,
        ) => void;
        servername?: string;
      };
    };
    close: Mock;
  }>,
}));

vi.mock("node:dns/promises", () => {
  class Resolver {
    resolve4 = mocks.resolve4;
    resolve6 = mocks.resolve6;
    cancel = mocks.cancel;
  }

  return { Resolver, default: { Resolver } };
});

vi.mock("undici", async (importOriginal) => {
  const { Response } = await importOriginal<typeof Undici>();

  return {
    Agent: class {
      close = vi.fn().mockResolvedValue(undefined);

      constructor(options: (typeof mocks.agents)[number]["options"]) {
        mocks.agents.push({ instance: this, options, close: this.close });
      }
    },
    fetch: mocks.fetch,
    Response,
  };
});

import { fetchJobDescriptionFromUrl } from "./source-job-description";

const listingHtml =
  '<div class="job-description">Build reliable systems for customers.</div>';

function htmlResponse(html = listingHtml): Response {
  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

describe("source job description refresh", () => {
  beforeEach(() => {
    mocks.resolve4.mockReset().mockResolvedValue(["93.184.216.34"]);
    mocks.resolve6.mockReset().mockResolvedValue([]);
    mocks.cancel.mockReset();
    mocks.fetch.mockReset().mockResolvedValue(htmlResponse());
    mocks.agents.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    "http://127.0.0.1/admin",
    "http://10.0.0.1/admin",
    "http://169.254.169.254/latest/meta-data",
    "http://192.0.2.1/job",
    "http://198.51.100.1/job",
    "http://203.0.113.1/job",
    "http://[::ffff:127.0.0.1]/admin",
    "http://[2001:db8::1]/job",
  ])("rejects non-public destination %s before fetching", async (url) => {
    await expect(fetchJobDescriptionFromUrl(url)).rejects.toMatchObject({
      code: "UNPROCESSABLE_ENTITY",
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("rejects hostnames that resolve to private destinations", async () => {
    mocks.resolve4.mockResolvedValueOnce(["127.0.0.1"]);

    await expect(
      fetchJobDescriptionFromUrl("http://jobs.example/admin"),
    ).rejects.toMatchObject({ code: "UNPROCESSABLE_ENTITY" });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it.each([
    "192.0.1.1",
    "198.51.1.1",
  ])("does not reject public address %s through an accidental /16", async (address) => {
    await expect(
      fetchJobDescriptionFromUrl(`http://${address}/job`),
    ).resolves.toBe("Build reliable systems for customers.");
    expect(mocks.fetch).toHaveBeenCalledOnce();
  });

  it("pins the socket lookup while retaining the original host and TLS SNI", async () => {
    await fetchJobDescriptionFromUrl("https://jobs.example/opening/1");

    expect(mocks.fetch).toHaveBeenCalledWith(
      new URL("https://jobs.example/opening/1"),
      expect.objectContaining({
        dispatcher: mocks.agents[0]?.instance,
        redirect: "manual",
      }),
    );
    const callback = vi.fn();
    mocks.agents[0]?.options.connect.lookup("jobs.example", {}, callback);
    expect(callback).toHaveBeenCalledWith(null, "93.184.216.34", 4);
    expect(mocks.agents[0]?.options.connect.servername).toBe("jobs.example");
    expect(mocks.agents[0]?.close).toHaveBeenCalledOnce();
  });

  it("validates and pins each redirect independently", async () => {
    mocks.resolve4
      .mockResolvedValueOnce(["93.184.216.34"])
      .mockResolvedValueOnce(["142.250.72.14"]);
    mocks.fetch
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://redirect.example/job/2" },
        }),
      )
      .mockResolvedValueOnce(htmlResponse());

    await fetchJobDescriptionFromUrl("https://jobs.example/job/1");

    const firstCallback = vi.fn();
    const secondCallback = vi.fn();
    mocks.agents[0]?.options.connect.lookup("jobs.example", {}, firstCallback);
    mocks.agents[1]?.options.connect.lookup(
      "redirect.example",
      {},
      secondCallback,
    );
    expect(firstCallback).toHaveBeenCalledWith(null, "93.184.216.34", 4);
    expect(secondCallback).toHaveBeenCalledWith(null, "142.250.72.14", 4);
    for (const { close } of mocks.agents) {
      expect(close).toHaveBeenCalledOnce();
    }
  });

  it("rejects a redirect that resolves privately before opening its socket", async () => {
    mocks.resolve4
      .mockResolvedValueOnce(["93.184.216.34"])
      .mockResolvedValueOnce(["127.0.0.1"]);
    mocks.fetch.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "http://redirect.example/latest/meta-data" },
      }),
    );

    await expect(
      fetchJobDescriptionFromUrl("https://jobs.example/job/1"),
    ).rejects.toMatchObject({ code: "UNPROCESSABLE_ENTITY" });
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(mocks.agents).toHaveLength(1);
    expect(mocks.agents[0]?.close).toHaveBeenCalledOnce();
  });

  it("cancels DNS resolution at the operation timeout", async () => {
    vi.useFakeTimers();
    let rejectDns: (reason?: unknown) => void = () => undefined;
    const dns = new Promise<string[]>((_resolve, reject) => {
      rejectDns = reject;
    });
    mocks.resolve4.mockReturnValueOnce(dns);
    mocks.cancel.mockImplementationOnce(() =>
      rejectDns(Object.assign(new Error("cancelled"), { code: "ECANCELLED" })),
    );

    const result = fetchJobDescriptionFromUrl("https://jobs.example/job/1");
    const timedOut = expect(result).rejects.toMatchObject({
      code: "REQUEST_TIMEOUT",
    });
    await vi.advanceTimersByTimeAsync(15_000);

    await timedOut;
    expect(mocks.cancel).toHaveBeenCalledOnce();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("aborts fetch and closes its dispatcher at the operation timeout", async () => {
    vi.useFakeTimers();
    let rejectRequest: (reason?: unknown) => void = () => undefined;
    const request = new Promise<Response>((_resolve, reject) => {
      rejectRequest = reject;
    });
    mocks.fetch.mockImplementationOnce(
      (_url: URL, { signal }: { signal: AbortSignal }) => {
        signal.addEventListener(
          "abort",
          () =>
            rejectRequest(
              Object.assign(new Error("aborted"), { name: "AbortError" }),
            ),
          { once: true },
        );
        return request;
      },
    );

    const result = fetchJobDescriptionFromUrl("https://jobs.example/job/1");
    const timedOut = expect(result).rejects.toMatchObject({
      code: "REQUEST_TIMEOUT",
    });
    await vi.advanceTimersByTimeAsync(15_000);

    await timedOut;
    expect(mocks.agents[0]?.close).toHaveBeenCalledOnce();
  });

  it("bounds the response before parsing HTML", async () => {
    mocks.fetch.mockResolvedValueOnce(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1));
            controller.close();
          },
        }),
        { headers: { "content-type": "text/html" } },
      ),
    );

    await expect(
      fetchJobDescriptionFromUrl("https://jobs.example/job/1"),
    ).rejects.toMatchObject({ code: "UNPROCESSABLE_ENTITY" });
  });

  it("rejects unsupported response types", async () => {
    mocks.fetch.mockResolvedValueOnce(
      new Response("not HTML", {
        headers: { "content-type": "application/pdf" },
      }),
    );

    await expect(
      fetchJobDescriptionFromUrl("https://jobs.example/job/1"),
    ).rejects.toMatchObject({ code: "UNPROCESSABLE_ENTITY" });
    expect(mocks.agents[0]?.close).toHaveBeenCalledOnce();
  });

  it("rejects arbitrary HTML that is not a job listing", async () => {
    mocks.fetch.mockResolvedValueOnce(
      htmlResponse("<html><body>Welcome to our company blog.</body></html>"),
    );

    await expect(
      fetchJobDescriptionFromUrl("https://jobs.example/job/1"),
    ).rejects.toMatchObject({ code: "UNPROCESSABLE_ENTITY" });
  });

  it("extracts a JobPosting structured description", async () => {
    mocks.fetch.mockResolvedValueOnce(
      htmlResponse(
        `<script type="application/ld+json">${JSON.stringify({
          "@context": "https://schema.org",
          "@type": "JobPosting",
          description: "<p>Build reliable systems for customers.</p>",
        })}</script>`,
      ),
    );

    await expect(
      fetchJobDescriptionFromUrl("https://jobs.example/job/1"),
    ).resolves.toBe("Build reliable systems for customers.");
  });
});
