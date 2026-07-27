// api/pitchers.js
//
// Starting pitcher context from the MLB Stats API. Free, no key.
//
//   /api/pitchers            (default: last 120 days)
//   /api/pitchers?days=60
//
// Returns two things:
//   games    — gamePk -> which pitcher started for each side
//   pitchers — pitcherId -> their season ERA, K/9, WHIP
//
// The frontend joins these onto a batter's game log, so instead of
// "the opposing staff had a 4.30 ERA" you get "he faced Skubal, 2.40 ERA".
//
// CAVEAT: MLB exposes the *announced probable* starter in bulk. For completed
// games this is almost always the pitcher who actually started, but late
// scratches exist. Treat it as very good, not perfect.

const SEASON = new Date().getFullYear();

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const days = Math.min(Number(req.query.days) || 120, 200);
  const season = req.query.season || SEASON;

  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - days);
  const fmt = (d) => d.toISOString().slice(0, 10);

  // Trim both responses hard — this is what keeps us inside the time limit.
  const schedFields = [
    "dates", "date", "games", "gamePk", "officialDate",
    "teams", "home", "away", "team", "id", "name",
    "probablePitcher", "fullName",
  ].join(",");

  const statFields = [
    "stats", "splits", "player", "id", "fullName", "stat",
    "era", "whip", "inningsPitched", "strikeOuts", "gamesStarted", "baseOnBalls",
  ].join(",");

  const scheduleUrl =
    `https://statsapi.mlb.com/api/v1/schedule` +
    `?sportId=1&gameType=R` +
    `&startDate=${fmt(start)}&endDate=${fmt(today)}` +
    `&hydrate=probablePitcher` +
    `&fields=${schedFields}`;

  const statsUrl =
    `https://statsapi.mlb.com/api/v1/stats` +
    `?stats=season&group=pitching&sportId=1&season=${season}` +
    `&limit=2000&playerPool=All` +
    `&fields=${statFields}`;

  try {
    const [schedRes, statsRes] = await Promise.all([
      fetch(scheduleUrl),
      fetch(statsUrl),
    ]);

    if (!schedRes.ok || !statsRes.ok) {
      return res.status(502).json({
        error: "MLB Stats API didn't return what we needed.",
        scheduleStatus: schedRes.status,
        statsStatus: statsRes.status,
      });
    }

    const sched = await schedRes.json();
    const statsData = await statsRes.json();

    // ---- gamePk -> starters ----
    const games = {};
    let withStarters = 0;

    for (const day of sched.dates || []) {
      for (const g of day.games || []) {
        if (!g.gamePk) continue;
        const home = g.teams?.home;
        const away = g.teams?.away;

        const entry = {
          date: g.officialDate || day.date,
          home: {
            teamId: home?.team?.id ?? null,
            pitcherId: home?.probablePitcher?.id ?? null,
            pitcherName: home?.probablePitcher?.fullName ?? null,
          },
          away: {
            teamId: away?.team?.id ?? null,
            pitcherId: away?.probablePitcher?.id ?? null,
            pitcherName: away?.probablePitcher?.fullName ?? null,
          },
        };

        if (entry.home.pitcherId || entry.away.pitcherId) withStarters++;
        games[g.gamePk] = entry;
      }
    }

    // ---- pitcherId -> season line ----
    const splits = [];
    for (const block of statsData?.stats || []) {
      for (const s of block?.splits || []) splits.push(s);
    }

    const pitchers = {};
    for (const s of splits) {
      const id = s.player?.id;
      if (!id) continue;
      const st = s.stat || {};
      const ip = numOrNull(st.inningsPitched);
      const k = numOrNull(st.strikeOuts);
      const bb = numOrNull(st.baseOnBalls);

      pitchers[id] = {
        id,
        name: s.player?.fullName || "",
        era: numOrNull(st.era),
        whip: numOrNull(st.whip),
        inningsPitched: ip,
        strikeOuts: k,
        gamesStarted: numOrNull(st.gamesStarted) ?? 0,
        k9: ip ? +((k / ip) * 9).toFixed(2) : null,
        bb9: ip && bb != null ? +((bb / ip) * 9).toFixed(2) : null,
      };
    }

    // League baselines among actual starters, so ranks mean something.
    const starters = Object.values(pitchers).filter(
      (p) => p.gamesStarted >= 5 && p.era != null
    );

    rank(starters, (p) => p.era, "asc", (p, r) => (p.eraRank = r));
    rank(starters, (p) => p.k9, "desc", (p, r) => (p.k9Rank = r));
    for (const p of starters) p.starterPool = starters.length;

    const leagueAvg = {
      starterEra: avg(starters.map((p) => p.era)),
      starterK9: avg(starters.map((p) => p.k9)),
      starterWhip: avg(starters.map((p) => p.whip)),
      starterCount: starters.length,
    };

    res.setHeader("Cache-Control", "s-maxage=10800, stale-while-revalidate=43200");

    return res.status(200).json({
      updatedAt: new Date().toISOString(),
      season: Number(season),
      source: "MLB Stats API",
      note: "Starters are the announced probable pitcher; late scratches may differ.",
      gameCount: Object.keys(games).length,
      gamesWithStarters: withStarters,
      pitcherCount: Object.keys(pitchers).length,
      leagueAvg,
      games,
      pitchers,
    });
  } catch (err) {
    return res.status(500).json({
      error: "Could not reach the MLB Stats API.",
      detail: String(err),
    });
  }
}

/* ---------------- helpers ---------------- */

function numOrNull(v) {
  if (v == null || v === "" || v === "-.--") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function rank(list, get, dir, set) {
  const sorted = [...list]
    .filter((p) => get(p) != null)
    .sort((a, b) => (dir === "asc" ? get(a) - get(b) : get(b) - get(a)));
  sorted.forEach((p, i) => set(p, i + 1));
}

function avg(arr) {
  const vals = arr.filter((v) => v != null);
  if (!vals.length) return null;
  return +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2);
}
