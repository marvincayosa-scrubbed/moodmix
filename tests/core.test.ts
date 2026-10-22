import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseInput,
  parsePlaylist,
  playlistCsv,
  playlistText,
} from "../lib/contracts";
import { matchingArtwork } from "../lib/artwork";
import { generate, enforceRateLimit, ServiceError } from "../lib/server";
import { POST } from "../app/api/generate/route";
const songs = Array.from({ length: 10 }, (_, i) => ({
  title: `Song ${i}`,
  artist: `Artist ${i}`,
}));
const playlist = {
  title: "Quiet hours",
  description: "A soft place to land.",
  songs,
};
function gemini(p: unknown = playlist) {
  return Response.json({
    candidates: [
      {
        finishReason: "STOP",
        content: { parts: [{ text: JSON.stringify(p) }] },
      },
    ],
  });
}
function configure() {
  process.env.GEMINI_API_KEY = "test-key";
  delete process.env.VERCEL;
}
const originalFetch = global.fetch;
test("input validates count, mood length and whitespace", () => {
  assert.deepEqual(parseInput({ mood: " quiet ", count: 10 }), {
    mood: "quiet",
    count: 10,
  });
  for (const v of [
    null,
    {},
    { mood: " ", count: 15 },
    { mood: "x".repeat(501), count: 15 },
    { mood: "hi", count: 11 },
    { mood: "hi", count: "15" },
  ])
    assert.throws(() => parseInput(v));
});
test("playlist validates exact count, bounds and normalized duplicates", () => {
  assert.deepEqual(parsePlaylist(playlist, 10), playlist);
  assert.throws(() => parsePlaylist(playlist, 15));
  assert.throws(() => parsePlaylist({ ...playlist, title: "" }, 10));
  assert.throws(() =>
    parsePlaylist(
      {
        ...playlist,
        songs: [
          ...songs.slice(0, 9),
          { title: " SONG 0! ", artist: "artist 0" },
        ],
      },
      10,
    ),
  );
});
test("exports escape CSV quotes, commas and spreadsheet formulas", () => {
  const p = {
    ...playlist,
    songs: [{ title: "=SUM(1,2)", artist: 'A "name"' }],
  };
  assert.equal(
    playlistCsv(p),
    'Position,Title,Artist\r\n1,"\'=SUM(1,2)","A ""name"""',
  );
  assert.match(playlistText(p), /1\. =SUM\(1,2\) — A "name"/);
});
test("artwork rejects unrelated title, artist and untrusted URLs", () => {
  const item = {
    trackName: "Song 0",
    artistName: "Artist 0",
    artworkUrl100: "https://is1-ssl.mzstatic.com/image.jpg",
  };
  assert.equal(
    matchingArtwork([item], "song 0", "Artist 0"),
    item.artworkUrl100,
  );
  assert.equal(matchingArtwork([item], "Song 1", "Artist 0"), null);
  assert.equal(matchingArtwork([item], "Song 0", "Artist 1"), null);
  assert.equal(
    matchingArtwork(
      [{ ...item, artworkUrl100: "https://evil.test/a" }],
      "Song 0",
      "Artist 0",
    ),
    null,
  );
});
test("backend integration and native Vercel rate limiting", async (t) => {
  const originalEnv = {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    VERCEL: process.env.VERCEL,
    NODE_ENV: process.env.NODE_ENV,
  };
  configure();
  const req = (body: unknown = { mood: "quiet", count: 10 }) =>
    new Request("http://moodmix.test/api/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        host: "moodmix.test",
        "x-real-ip": "203.0.113.1",
      },
      body: JSON.stringify(body),
    });
  const deployed = () =>
    Object.assign(process.env, { VERCEL: "1", NODE_ENV: "production" });
  t.after(() => {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  await t.test(
    "missing Gemini fails before rate check or model call",
    async () => {
      deployed();
      delete process.env.GEMINI_API_KEY;
      let calls = 0;
      global.fetch = async () => {
        calls++;
        return gemini();
      };
      const r = await POST(req());
      assert.equal(r.status, 503);
      assert.equal(calls, 0);
      configure();
    },
  );
  await t.test(
    "local development needs Gemini only and no platform rate check",
    async () => {
      configure();
      let calls = 0;
      global.fetch = async (url) => {
        calls++;
        assert.match(String(url), /generativelanguage/);
        return gemini();
      };
      const r = await POST(req());
      assert.equal(r.status, 200);
      assert.equal((await r.json()).songs.length, 10);
      assert.equal(calls, 1);
    },
  );
  await t.test("valid model response makes one call", async () => {
    let calls = 0;
    global.fetch = async () => {
      calls++;
      return gemini();
    };
    assert.deepEqual(await generate("quiet", 10), playlist);
    assert.equal(calls, 1);
  });
  await t.test("malformed output gets at most one retry", async () => {
    let calls = 0;
    global.fetch = async () => {
      calls++;
      return gemini({});
    };
    await assert.rejects(() => generate("quiet", 10));
    assert.equal(calls, 2);
  });
  await t.test("malformed then valid output recovers", async () => {
    let calls = 0;
    global.fetch = async () => (++calls === 1 ? gemini({}) : gemini());
    assert.deepEqual(await generate("quiet", 10), playlist);
    assert.equal(calls, 2);
  });
  for (const [status, code] of [
    [400, "GEMINI_REQUEST_REJECTED"],
    [401, "GEMINI_INVALID_KEY"],
    [403, "GEMINI_ACCESS_DENIED"],
    [404, "GEMINI_MODEL_NOT_FOUND"],
    [429, "GEMINI_QUOTA_EXCEEDED"],
    [500, "GEMINI_UNAVAILABLE"],
    [503, "GEMINI_UNAVAILABLE"],
  ] as const)
    await t.test(`Gemini ${status} never retries`, async () => {
      let calls = 0;
      global.fetch = async () => {
        calls++;
        return new Response(null, { status });
      };
      await assert.rejects(
        () => generate("quiet", 10),
        (e: unknown) =>
          e instanceof ServiceError &&
          e.code === code &&
          e.upstreamStatus === status,
      );
      assert.equal(calls, 1);
    });
  await t.test(
    "Google's invalid-key 400 is recognized without leaking its response",
    async () => {
      let calls = 0;
      global.fetch = async () => {
        calls++;
        return Response.json(
          {
            error: {
              message: "PRIVATE PROVIDER DETAILS",
              details: [{ reason: "API_KEY_INVALID" }],
            },
          },
          { status: 400 },
        );
      };
      await assert.rejects(
        () => generate("quiet", 10),
        (e: unknown) =>
          e instanceof ServiceError &&
          e.code === "GEMINI_INVALID_KEY" &&
          !e.message.includes("PRIVATE PROVIDER DETAILS"),
      );
      assert.equal(calls, 1);
    },
  );
  await t.test("model timeout never retries", async () => {
    let calls = 0;
    global.fetch = async () => {
      calls++;
      throw new DOMException("Timeout", "TimeoutError");
    };
    await assert.rejects(() => generate("quiet", 10));
    assert.equal(calls, 1);
  });
  await t.test(
    "invalid input does not check rate limit or call Gemini",
    async () => {
      deployed();
      let calls = 0;
      global.fetch = async () => {
        calls++;
        return gemini();
      };
      assert.equal((await POST(req({ mood: " ", count: 10 }))).status, 400);
      assert.equal(calls, 0);
    },
  );
  await t.test(
    "cross-site requests rejected before external calls",
    async () => {
      const r = new Request("http://moodmix.test/api/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          origin: "https://evil.test",
        },
        body: "{}",
      });
      assert.equal((await POST(r)).status, 403);
    },
  );
  await t.test(
    "native limit rejection stops Gemini and invents no counters",
    async () => {
      let calls = 0;
      global.fetch = async (url) => {
        calls++;
        assert.match(
          String(url),
          /\.well-known\/vercel\/rate-limit-api\/moodmix-generation$/,
        );
        return new Response(null, { status: 429 });
      };
      const r = await POST(req());
      assert.equal(r.status, 429);
      const b = await r.json();
      assert.equal(b.error.code, "RATE_LIMITED");
      assert.equal(b.error.consumed, false);
      assert.equal(b.usage, undefined);
      assert.equal(r.headers.get("Retry-After"), null);
      assert.equal(calls, 1);
    },
  );
  for (const status of [404, 500])
    await t.test(`native rule status ${status} fails closed`, async () => {
      let calls = 0;
      global.fetch = async () => {
        calls++;
        return new Response(null, { status });
      };
      const r = await POST(req());
      assert.equal(r.status, 503);
      assert.equal((await r.json()).error.consumed, false);
      assert.equal(calls, 1);
    });
  await t.test("firewall blocked returns 403 without generation", async () => {
    let calls = 0;
    global.fetch = async () => {
      calls++;
      return new Response(null, { status: 403 });
    };
    const r = await POST(req());
    assert.equal(r.status, 403);
    assert.equal((await r.json()).error.code, "FIREWALL_BLOCKED");
    assert.equal(calls, 1);
  });
  await t.test("native rate check timeout fails closed", async () => {
    let calls = 0;
    global.fetch = async (_url, options) => {
      calls++;
      assert.ok(options?.signal);
      throw new DOMException("Timeout", "TimeoutError");
    };
    assert.equal((await POST(req())).status, 503);
    assert.equal(calls, 1);
  });
  await t.test(
    "allowed request invokes Gemini after native check",
    async () => {
      let calls = 0;
      global.fetch = async (url) => {
        calls++;
        if (calls === 1) {
          assert.match(String(url), /rate-limit-api/);
          return new Response(null, { status: 204 });
        }
        assert.match(String(url), /generativelanguage/);
        return gemini();
      };
      const r = await POST(req());
      assert.equal(r.status, 200);
      const b = await r.json();
      assert.equal(b.songs.length, 10);
      assert.equal(b.usage, undefined);
      assert.equal(calls, 2);
    },
  );
  await t.test(
    "accepted Gemini failure does not repeat native rate check",
    async () => {
      let calls = 0;
      global.fetch = async () =>
        ++calls === 1
          ? new Response(null, { status: 204 })
          : new Response(null, { status: 429 });
      const r = await POST(req());
      assert.equal(r.status, 502);
      const body = await r.json();
      assert.equal(body.error.consumed, true);
      assert.equal(body.error.code, "GEMINI_QUOTA_EXCEEDED");
      assert.equal(body.error.upstreamStatus, 429);
      assert.equal(calls, 2);
    },
  );
  await t.test(
    "deployed development build cannot bypass the SDK check",
    async () => {
      Object.assign(process.env, { NODE_ENV: "development" });
      let calls = 0;
      global.fetch = async () => {
        calls++;
        return gemini();
      };
      await assert.rejects(() => enforceRateLimit(req()), ServiceError);
      assert.equal(calls, 0);
    },
  );
});
