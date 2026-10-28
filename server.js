import "dotenv/config";
import express from "express";

const E = process.env, TOKEN = E.SPORTMONKS_TOKEN;
if (!TOKEN || TOKEN === "your_token_here") { console.error("Missing SPORTMONKS_TOKEN. Copy .env.example to .env and add your token."); process.exit(1); }
const N = (k, d) => Number(E[k] ?? d);
const CFG = { port: N("PORT", 3000), poll: N("POLL_SECONDS", 30), gap: N("THROTTLE_MS", 250), pages: N("MAX_PAGES", 6),
  dailyTtl: N("DAILY_CACHE_SECONDS", 60) * 1000, england: E.ENGLAND_LEAGUES || "8,9,24,27" };
const BASE = "https://api.sportmonks.com/v3/football";
const MI = "participants;scores;state;league.country;periods";

let chain = Promise.resolve(), calls = 0, rate = null;
const gate = () => (chain = chain.then(() => new Promise(r => setTimeout(r, CFG.gap))));   // spaces every upstream call
const cache = new Map(), inflight = new Map();
const wait = ms => new Promise(r => setTimeout(r, ms));

async function sm(path, params = {}, ttl = 10_000, timeout = 12_000) {
  const u = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
  const key = u.toString(), hit = cache.get(key);                 // key excludes the token
  if (hit && Date.now() - hit.t < ttl) return hit.body;
  if (inflight.has(key)) return inflight.get(key);                // merge duplicate requests
  u.searchParams.set("api_token", TOKEN);
  const p = (async () => {
    try {
      for (let i = 0; ; i++) {
        await gate(); calls++;
        const r = await fetch(u, { signal: AbortSignal.timeout(timeout) });
        if (r.status === 429 && i < 2) { await wait((+r.headers.get("retry-after") || 2) * 1000); continue; }
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw Object.assign(new Error(body.message || `HTTP ${r.status}`), { status: r.status });
        if (body.rate_limit) rate = body.rate_limit;
        cache.set(key, { t: Date.now(), body });
        return body;
      }
    } catch (e) {
      if (hit) return { ...hit.body, stale: true };               // serve last good data
      throw e;
    } finally { inflight.delete(key); }
  })();
  inflight.set(key, p);
  return p;
}

const app = express();
app.use(express.static("public"));
const fail = (res, e) => res.status(e.status || 500).json({ error: e.message });
app.get("/api/config", (_q, res) => res.json({ poll: CFG.poll }));

app.get("/api/matches", async (req, res) => {
  try {
    const { mode = "live", date, leagues = "all" } = req.query, c0 = calls;
    const ids = leagues === "england" ? CFG.england.split(",") : [];
    const params = { include: MI };
    if (ids.length) params.filters = `fixtureLeagues:${ids.join(",")}`;
    const live = mode === "live";
    const path = live ? "/livescores/inplay" : `/fixtures/date/${date || new Date().toISOString().slice(0, 10)}`;
    let out = [], stale = false, page = 1;
    for (; page <= CFG.pages; page++) {
      const b = await sm(path, { ...params, page: String(page), per_page: "50" }, live ? 10_000 : CFG.dailyTtl, live ? 12_000 : 30_000);
      out = out.concat(b.data || []); stale ||= !!b.stale;
      if (!b.pagination?.has_more) break;
    }
    if (ids.length) out = out.filter(f => ids.includes(String(f.league_id)));
    res.json({ data: out, rate_limit: rate, calls: calls - c0, capped: page > CFG.pages, stale });
  } catch (e) { fail(res, e); }
});

const detail = (suffix, inc, ttl) => app.get(`/api/fixture/:id${suffix}`, async (q, s) => {
  try {
    const b = await sm(`/fixtures/${encodeURIComponent(q.params.id)}`, { include: inc }, ttl);
    s.json(q.query.raw ? b : { data: b.data, rate_limit: rate, stale: b.stale });   // ?raw=1 shows Sportmonks' own response
  } catch (e) { fail(s, e); }
});
detail("", `${MI};events.type`, 10_000);
detail("/stats", "statistics.type;participants", 15_000);
detail("/lineups", "lineups;formations;coaches;participants", 60_000);

app.get("/api/standings/:season", async (q, s) => {
  try {
    const b = await sm(`/standings/seasons/${encodeURIComponent(q.params.season)}`, { include: "participant;form;details.type" }, 60_000);
    s.json(q.query.raw ? b : { data: b.data, stale: b.stale });
  } catch (e) { fail(s, e); }
});

app.listen(CFG.port, () => console.log(`Matchday running at http://localhost:${CFG.port}`));
