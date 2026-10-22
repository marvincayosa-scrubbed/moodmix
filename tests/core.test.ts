import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseInput,
  parsePlaylist,
  playlistCsv,
  playlistText,
} from "../lib/contracts";
import { matchingArtwork } from "../lib/artwork";
import { generate, quota, ServiceError } from "../lib/server";
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
  process.env.UPSTASH_REDIS_REST_URL = "https://test.upstash.io";
  process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
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
test("backend integration and retry policy", async (t) => {
  configure();
  t.after(() => {
    global.fetch = originalFetch;
  });
  await t.test(
    "missing config fails closed without calling external APIs",
    async () => {
      delete process.env.GEMINI_API_KEY;
      let calls = 0;
      global.fetch = async () => {
        calls++;
        return gemini();
      };
      await assert.rejects(
        () => quota(new Request("http://localhost"), true),
        ServiceError,
      );
      assert.equal(calls, 0);
      configure();
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
  await t.test("malformed output gets only one internal retry", async () => {
    let calls = 0;
    global.fetch = async () => {
      calls++;
      return gemini({ ...playlist, songs: [] });
    };
    await assert.rejects(() => generate("quiet", 10));
    assert.equal(calls, 2);
  });
  await t.test("malformed then valid recovers", async () => {
    let calls = 0;
    global.fetch = async () => (++calls === 1 ? gemini({}) : gemini());
    assert.deepEqual(await generate("quiet", 10), playlist);
    assert.equal(calls, 2);
  });
  for (const status of [401, 403, 429, 500])
    await t.test(`upstream ${status} never retries`, async () => {
      let calls = 0;
      global.fetch = async () => {
        calls++;
        return new Response("", { status });
      };
      await assert.rejects(() => generate("quiet", 10));
      assert.equal(calls, 1);
    });
  await t.test("network timeout never retries", async () => {
    let calls = 0;
    global.fetch = async () => {
      calls++;
      throw new DOMException("Timed out", "TimeoutError");
    };
    await assert.rejects(() => generate("quiet", 10));
    assert.equal(calls, 1);
  });
  const req = (body: unknown) =>
    new Request("http://localhost/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  await t.test("invalid input never reserves quota", async () => {
    let calls = 0;
    global.fetch = async () => {
      calls++;
      return gemini();
    };
    assert.equal((await POST(req({ mood: " ", count: 10 }))).status, 400);
    assert.equal(calls, 0);
  });
  await t.test("cross-site generation rejected", async () => {
    const r = new Request("http://localhost/api/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        origin: "https://evil.test",
      },
      body: "{}",
    });
    assert.equal((await POST(r)).status, 403);
  });
  await t.test(
    "limit rejection prevents model call and returns retry-after",
    async () => {
      let calls = 0;
      global.fetch = async () => {
        calls++;
        return Response.json({ result: [0, 0, Date.now() + 60000] });
      };
      const r = await POST(req({ mood: "quiet", count: 10 }));
      assert.equal(r.status, 429);
      assert.ok(r.headers.get("Retry-After"));
      assert.equal((await r.json()).usage.remaining, 0);
      assert.equal(calls, 1);
    },
  );
  await t.test("store failure never calls model", async () => {
    let calls = 0;
    global.fetch = async () => {
      calls++;
      return new Response("", { status: 503 });
    };
    const r = await POST(req({ mood: "quiet", count: 10 }));
    assert.equal(r.status, 503);
    assert.equal(calls, 1);
  });
  await t.test("accepted failure keeps consumed quota", async () => {
    let calls = 0;
    global.fetch = async () =>
      ++calls === 1
        ? Response.json({ result: [1, 4, Date.now() + 86400000] })
        : new Response("", { status: 429 });
    const r = await POST(req({ mood: "quiet", count: 10 }));
    assert.equal(r.status, 502);
    const b = await r.json();
    assert.equal(b.error.consumed, true);
    assert.equal(b.usage.remaining, 4);
    assert.equal(calls, 2);
  });
  await t.test(
    "successful API returns validated songs and reserved usage",
    async () => {
      let calls = 0;
      global.fetch = async () =>
        ++calls === 1
          ? Response.json({ result: [1, 4, Date.now() + 86400000] })
          : gemini();
      const r = await POST(req({ mood: "quiet", count: 10 }));
      assert.equal(r.status, 200);
      const b = await r.json();
      assert.equal(b.songs.length, 10);
      assert.equal(b.usage.remaining, 4);
      assert.equal(calls, 2);
    },
  );
  await t.test(
    "quota command uses a hashed identity and atomic EVAL",
    async () => {
      let command: unknown[] = [];
      global.fetch = async (_url, options) => {
        command = JSON.parse(String(options?.body));
        return Response.json({ result: [1, 4, Date.now() + 86400000] });
      };
      await quota(
        new Request("http://localhost", {
          headers: { "x-forwarded-for": "1.2.3.4" },
        }),
        true,
      );
      assert.equal(command[0], "EVAL");
      assert.match(String(command[3]), /^moodmix:v1:[a-f0-9]{64}$/);
      assert.equal(command[5], "1");
      assert.ok(!JSON.stringify(command).includes("1.2.3.4"));
    },
  );
});
