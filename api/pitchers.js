// api/pitchers.js
//
// Matchup context from the MLB Stats API. Free, no key.
//
//   /api/pitchers            (default: last 120 days)
//   /api/pitchers?days=60
//
// Returns four things:
//   games   — gamePk -> starters for each side, plus the venue
//   pitchers— pitcherId -> season ERA, K/9, WHIP, league rank
//   hands   — playerId  -> bats L/R/S and throws L/R
//   parks   — venueId   -> approximate park factor
//
// CAVEATS worth repeating in the UI:
//  - Starters are the announced probable pitcher. Late scratches exist.
//  - Park factors below are approximate public figures, hand-entered, and they
//    drift year to year. Treat them as a nudge, not a measurement. Verify against
//    Baseball Savant if you ever rely on them for anything real.

const SEASON = new Date().getFullYear();

// 100 = neutral. Above 100 favours hitters, below favours pitchers.
// Approximate multi-year figures — see caveat above.
const PARKS = {
  15:  { name: "Chase Field",            factor: 103 },
  4705:{ name: "Truist Park",            factor: 101 },
  2:   { name: "Camden Yards",           factor: 100 },
  3:   { name: "Fenway Park",            factor: 106 },
  17:  { name: "Wrigley Field",          factor: 102 },
  4:   { name: "Rate Field",             factor: 103 },
  2602:{ name: "Great American Ball Park", factor: 105 },
  5:   { name: "Progressive Field",      factor: 98 },
  19:  { name: "Coors Field",            factor: 113 },
  2394:{ name: "Comerica Park",          factor: 99 },
  2392:{ name: "Daikin Park",            factor: 101 },
  7:   { name: "Kauffman Stadium",       factor: 101 },
  1:   { name: "Angel Stadium",          factor: 101 },
  22:  { name: "Dodger Stadium",         factor: 101 },
  4169:{ name: "loanDepot park",         factor: 95  },
  32:  { name: "American Family Field",  factor: 101 },
  3312:{ name: "Target Field",           factor: 99  },
  3289:{ name: "Citi Field",             factor: 97  },
  3313:{ name: "Yankee Stadium",         factor: 103 },
  10:  { name: "Sutter Health Park",     factor: 103 },
  2681:{ name: "Citizens Bank Park",     factor: 104 },
  31:  { name: "PNC Park",               factor: 98  },
  2680:{ name: "Petco Park",             factor: 95  },
  2395:{ name: "Oracle Park",            factor: 96  },
  680: { name: "T-Mobile Park",          factor: 93  },
  2889:{ name: "Busch Stadium",          factor: 97  },
  12:  { name: "Steinbrenner Field",     factor: 102 },
  5325:{ name: "Globe Life Field",       factor: 100 },
  14:  { name: "Rogers Centre",          factor: 102 },
  3309:{ name: "Nationals Park",         factor: 101 },
};

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

  const schedFields = [
    "dates", "date", "games", "gamePk", "officialDate",
    "teams", "home", "away", "team", "id", "name",
    "probablePitcher", "fullName", "venue",
  ].join(",");

  const statFields = [
    "stats", "splits", "player", "id", "fullName", "stat",
    "era", "whip", "inningsPitched", "strikeOuts", "gamesStarted", "baseOnBalls",
  ].join(",");

  const peopleFields = [
    "people", "id", "fullName", "batSide", "pitchHand", "code",
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
    `&limit=2000&playerPool=All&fields=${statFields}`;

  // Every player in the league in one call — gives us bats/throws for all of them.
  const peopleUrl =
    `https://statsapi.mlb.com/api/v1/sports/1/players` +
    `?season=${season}&fields=${peopleFields}`;

  try {
    const [schedRes, statsRes, peopleRes] = await Promise.all([
      fetch(scheduleUrl),
      fetch(statsUrl),
      fetch(peopleUrl),
    ]);

    if (!schedRes.ok || !statsRes.ok) {
      return res.status(502).json({
        error: "MLB Stats API didn't return what we needed.",
        scheduleStatus: schedRes.status,
        statsStatus: statsRes.status,
        peopleStatus: peopleRes.status,
      });
    }

    const sched = await schedRes.json();
    const statsData = await statsRes.json();
    const peopleData = peopleRes.ok ? await peopleRes.json() : { people: [] };

    // ---- gamePk -> starters + venue ----
    const games = {};
    let withStarters = 0;
    let withVenue = 0;

    for (const day of sched.dates || []) {
      for (const g of day.games || []) {
        if (!g.gamePk) continue;
        const home = g.teams?.home;
        const away = g.teams?.away;
        const venueId = g.venue?.id ?? null;

        const entry = {
          date: g.officialDate || day.date,
          venueId,
          venue: g.venue?.name || null,
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
        if (venueId) withVenue++;
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

    const starters = Object.values(pitchers).filter(
      (p) => p.gamesStarted >= 5 && p.era != null
    );
    rank(starters, (p) => p.era, "asc", (p, r) => (p.eraRank = r));
    rank(starters, (p) => p.k9, "desc", (p, r) => (p.k9Rank = r));
    for (const p of starters) p.starterPool = starters.length;

    // ---- playerId -> bats / throws ----
    const hands = {};
    for (const p of peopleData.people || []) {
      if (!p.id) continue;
      hands[p.id] = {
        bats: p.batSide?.code || null,   // L, R, or S (switch)
        throws: p.pitchHand?.code || null, // L or R
      };
    }

    // Attach throwing hand onto the pitcher records for convenience.
    for (const id of Object.keys(pitchers)) {
      const h = hands[id];
      if (h?.throws) pitchers[id].throws = h.throws;
    }

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
      notes: {
        starters: "Announced probable pitcher; late scratches may differ.",
        parks: "Approximate public park factors, hand-entered. 100 = neutral. Verify before relying on them.",
      },
      gameCount: Object.keys(games).length,
      gamesWithStarters: withStarters,
      gamesWithVenue: withVenue,
      pitcherCount: Object.keys(pitchers).length,
      handCount: Object.keys(hands).length,
      leagueAvg,
      parks: PARKS,
      games,
      pitchers,
      hands,
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
