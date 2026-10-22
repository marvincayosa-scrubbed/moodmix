import { test } from "node:test";
import assert from "node:assert/strict";
import { createSpotifyClient, SpotifyError } from "../lib/spotify";
import {
  matchingSpotifyTrack,
  spotifyEmbedUrl,
} from "../lib/spotify-contracts";
import { GET } from "../app/api/spotify/route";
const id = "0123456789ABCDEFGHIJKL";
const item = {
  id,
  name: "Holocene",
  artists: [{ name: "Bon Iver" }],
  type: "track",
  is_playable: true,
};
const token = () =>
  Response.json({
    access_token: "private-access-token",
    token_type: "Bearer",
    expires_in: 3600,
  });
const search = (items: unknown[] = [item]) =>
  Response.json({ tracks: { items } });

test("Spotify matching uses exact normalized names and safe track IDs", () => {
  assert.deepEqual(matchingSpotifyTrack([item], "HOLOCENE!", "Bon Iver"), {
    id,
    title: "Holocene",
    artists: ["Bon Iver"],
  });
  assert.equal(matchingSpotifyTrack([item], "Other song", "Bon Iver"), null);
  assert.equal(matchingSpotifyTrack([item], "Holocene", "Cover Artist"), null);
  assert.equal(
    matchingSpotifyTrack(
      [{ ...item, id: "../bad?x=y" }],
      "Holocene",
      "Bon Iver",
    ),
    null,
  );
  assert.equal(
    matchingSpotifyTrack(
      [{ ...item, type: "episode" }],
      "Holocene",
      "Bon Iver",
    ),
    null,
  );
  assert.equal(
    matchingSpotifyTrack(
      [{ ...item, is_playable: false }],
      "Holocene",
      "Bon Iver",
    ),
    null,
  );
  assert.equal(
    matchingSpotifyTrack([{ ...item, artists: [] }], "Holocene", "Bon Iver"),
    null,
  );
  assert.equal(
    matchingSpotifyTrack([null, {}, "bad"], "Holocene", "Bon Iver"),
    null,
  );
  assert.equal(
    matchingSpotifyTrack(
      [{ ...item, name: "!!!", artists: [{ name: "???" }] }],
      "!",
      "?",
    ),
    null,
  );
  assert.equal(
    spotifyEmbedUrl(id),
    `https://open.spotify.com/embed/track/${id}?utm_source=moodmix&theme=0`,
  );
  assert.throws(() => spotifyEmbedUrl("https://evil.test/track"));
});
test("Spotify client and route failures preserve playlist independence and secrets", async (t) => {
  const previous = {
    SPOTIFY_CLIENT_ID: process.env.SPOTIFY_CLIENT_ID,
    SPOTIFY_CLIENT_SECRET: process.env.SPOTIFY_CLIENT_SECRET,
    SPOTIFY_MARKET: process.env.SPOTIFY_MARKET,
  };
  const originalFetch = global.fetch;
  const configure = () =>
    Object.assign(process.env, {
      SPOTIFY_CLIENT_ID: "test-client-id",
      SPOTIFY_CLIENT_SECRET: "private-client-secret",
      SPOTIFY_MARKET: "US",
    });
  t.after(() => {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  await t.test("missing credentials never make upstream calls", async () => {
    delete process.env.SPOTIFY_CLIENT_ID;
    delete process.env.SPOTIFY_CLIENT_SECRET;
    let calls = 0;
    const lookup = createSpotifyClient(async () => {
      calls++;
      return token();
    });
    await assert.rejects(
      () => lookup("Holocene", "Bon Iver"),
      (e: unknown) =>
        e instanceof SpotifyError && e.code === "SPOTIFY_NOT_CONFIGURED",
    );
    const r = await GET(
      new Request(
        "http://localhost/api/spotify?title=Holocene&artist=Bon%20Iver",
      ),
    );
    assert.equal(r.status, 503);
    assert.ok(!(await r.text()).includes("private-client-secret"));
    assert.equal(calls, 0);
    configure();
  });
  await t.test("invalid request rejected before Spotify calls", async () => {
    for (const query of [
      "title=x",
      "artist=y",
      "title=%20&artist=x",
      `title=${"x".repeat(201)}&artist=y`,
    ])
      assert.equal(
        (await GET(new Request(`http://localhost/api/spotify?${query}`)))
          .status,
        400,
      );
  });
  await t.test(
    "lookup exchanges credentials server-side and caches the token",
    async () => {
      let tokenCalls = 0,
        searchCalls = 0;
      const lookup = createSpotifyClient(async (input, options) => {
        const url = String(input);
        assert.ok(options?.signal);
        if (url.includes("accounts.spotify.com")) {
          tokenCalls++;
          assert.equal(options?.method, "POST");
          assert.equal(options?.body, "grant_type=client_credentials");
          assert.match(
            new Headers(options?.headers).get("authorization")!,
            /^Basic /,
          );
          return token();
        }
        searchCalls++;
        const params = new URL(url).searchParams;
        assert.equal(params.get("type"), "track");
        assert.equal(params.get("market"), "US");
        assert.equal(params.get("q"), 'track:"Holocene" artist:"Bon Iver"');
        assert.equal(
          new Headers(options?.headers).get("authorization"),
          "Bearer private-access-token",
        );
        return search();
      });
      assert.equal((await lookup("Holocene", "Bon Iver"))?.id, id);
      await lookup("Holocene", "Bon Iver");
      assert.equal(tokenCalls, 1);
      assert.equal(searchCalls, 2);
    },
  );
  await t.test("concurrent lookups share one token request", async () => {
    let count = 0;
    const lookup = createSpotifyClient(async (input) => {
      if (String(input).includes("accounts.")) {
        count++;
        await new Promise((r) => setTimeout(r, 10));
        return token();
      }
      return search();
    });
    await Promise.all(
      Array.from({ length: 6 }, () => lookup("Holocene", "Bon Iver")),
    );
    assert.equal(count, 1);
  });
  await t.test(
    "no matching track returns null rather than a guessed player",
    async () => {
      let calls = 0;
      const lookup = createSpotifyClient(async () =>
        ++calls === 1
          ? token()
          : search([{ ...item, artists: [{ name: "Unrelated artist" }] }]),
      );
      assert.equal(await lookup("Holocene", "Bon Iver"), null);
    },
  );
  for (const status of [401, 403, 429, 500])
    await t.test(`search ${status} is handled without retrying`, async () => {
      let calls = 0;
      const lookup = createSpotifyClient(async () =>
        ++calls === 1
          ? token()
          : new Response("private-provider-details", { status }),
      );
      await assert.rejects(
        () => lookup("Holocene", "Bon Iver"),
        (e: unknown) =>
          e instanceof SpotifyError &&
          e.status === (status === 429 ? 429 : 503) &&
          !e.message.includes("private-provider-details"),
      );
      assert.equal(calls, 2);
    });
  await t.test("expired tokens are refreshed on the next lookup", async () => {
    let tokenCalls = 0;
    const lookup = createSpotifyClient(async (input) =>
      String(input).includes("accounts.")
        ? (tokenCalls++,
          Response.json({
            access_token: "token",
            token_type: "Bearer",
            expires_in: 1,
          }))
        : search(),
    );
    await lookup("Holocene", "Bon Iver");
    await lookup("Holocene", "Bon Iver");
    assert.equal(tokenCalls, 2);
  });
  await t.test("authentication failure does not call search", async () => {
    let calls = 0;
    const lookup = createSpotifyClient(async () => {
      calls++;
      return new Response("", { status: 401 });
    });
    await assert.rejects(() => lookup("Holocene", "Bon Iver"));
    assert.equal(calls, 1);
  });
  await t.test("token timeout does not retry or call search", async () => {
    let calls = 0;
    const lookup = createSpotifyClient(async () => {
      calls++;
      throw new DOMException("Timeout", "TimeoutError");
    });
    await assert.rejects(() => lookup("Holocene", "Bon Iver"));
    assert.equal(calls, 1);
  });
  await t.test("malformed upstream results fail safely", async () => {
    let calls = 0;
    const lookup = createSpotifyClient(async () =>
      ++calls === 1 ? token() : Response.json({ unexpected: "private-data" }),
    );
    await assert.rejects(() => lookup("Holocene", "Bon Iver"), SpotifyError);
  });
  await t.test(
    "route returns only public matched metadata and never tokens",
    async () => {
      let calls = 0;
      global.fetch = async () => (++calls === 1 ? token() : search());
      const r = await GET(
        new Request(
          "http://localhost/api/spotify?title=Holocene&artist=Bon%20Iver",
        ),
      );
      assert.equal(r.status, 200);
      assert.equal(r.headers.get("Cache-Control"), "no-store");
      const body = await r.text();
      assert.ok(!body.includes("private-"));
      assert.deepEqual(JSON.parse(body), {
        track: { id, title: "Holocene", artists: ["Bon Iver"] },
      });
      assert.equal(calls, 2);
    },
  );
});
