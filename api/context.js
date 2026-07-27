// api/context.js
//
// Opponent context from the MLB Stats API. Free, no key.
//
//   /api/context
//
// Returns every team's season hitting and pitching profile, with a league rank
// for each measure. Used to answer "was that performance against a soft matchup
// or a hard one?"
//
// Key derived numbers:
//   hitting.kRate  — how often this lineup strikes out (high = easy K's for pitchers)
//   pitching.k9    — strikeouts per 9 innings by this team's pitchers

const SEASON = new Date().getFullYear();

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const season = req.query.season || SEASON;

  const base = "https://statsapi.mlb.com/api/v1/teams/stats";
  const hittingUrl = `${base}?season=${season}&sportIds=1&stats=season&group=hitting`;
  const pitchingUrl = `${base}?season=${season}&sportIds=1&stats=season&group=pitching`;

  try {
    const [hitRes, pitRes] = await Promise.all([
      fetch(hittingUrl),
      fetch(pitchingUrl),
    ]);

    if (!hitRes.ok || !pitRes.ok) {
      return res.status(502).json({
        error: "MLB Stats API didn't return team stats.",
        hittingStatus: hitRes.status,
        pitchingStatus: pitRes.status,
      });
    }

    const hitData = await hitRes.json();
    const pitData = await pitRes.json();

    const hitSplits = collectSplits(hitData);
    const pitSplits = collectSplits(pitData);

    if (!hitSplits.length || !pitSplits.length) {
      return res.status(502).json({
        error: "Team stats came back empty.",
        hint: "The season may not have started, or the response shape changed.",
        hittingSplits: hitSplits.length,
        pitchingSplits: pitSplits.length,
      });
    }

    const teams = {};

    // ---- hitting profile (what this lineup does at the plate) ----
    for (const s of hitSplits) {
      const name = s.team?.name;
      if (!name) continue;
      const st = s.stat || {};

      const pa = num(st.plateAppearances);
      const k = num(st.strikeOuts);
      const bb = num(st.baseOnBalls);

      teams[name] = teams[name] || { name, id: s.team?.id };
      teams[name].hitting = {
        plateAppearances: pa,
        strikeOuts: k,
        kRate: pa ? +(k / pa).toFixed(4) : null,
        bbRate: pa ? +(bb / pa).toFixed(4) : null,
        avg: numOrNull(st.avg),
        ops: numOrNull(st.ops),
        homeRuns: num(st.homeRuns),
        runs: num(st.runs),
        runsPerGame: num(st.gamesPlayed) ? +(num(st.runs) / num(st.gamesPlayed)).toFixed(2) : null,
      };
    }

    // ---- pitching profile (what this team's staff does) ----
    for (const s of pitSplits) {
      const name = s.team?.name;
      if (!name) continue;
      const st = s.stat || {};

      const ip = num(st.inningsPitched);
      const k = num(st.strikeOuts);

      teams[name] = teams[name] || { name, id: s.team?.id };
      teams[name].pitching = {
        inningsPitched: ip,
        strikeOuts: k,
        k9: ip ? +((k / ip) * 9).toFixed(2) : null,
        era: numOrNull(st.era),
        whip: numOrNull(st.whip),
        homeRunsAllowed: num(st.homeRuns),
      };
    }

    const list = Object.values(teams).filter((t) => t.hitting && t.pitching);

    // ---- league ranks ----
    // Rank 1 = most strikeout-prone lineup (best matchup for a pitcher's K prop).
    rank(list, (t) => t.hitting.kRate, "desc", (t, r) => (t.hitting.kRateRank = r));
    // Rank 1 = best offence.
    rank(list, (t) => t.hitting.ops, "desc", (t, r) => (t.hitting.opsRank = r));
    rank(list, (t) => t.hitting.runsPerGame, "desc", (t, r) => (t.hitting.runsRank = r));
    // Rank 1 = staff that strikes out the most.
    rank(list, (t) => t.pitching.k9, "desc", (t, r) => (t.pitching.k9Rank = r));
    // Rank 1 = best ERA (lowest).
    rank(list, (t) => t.pitching.era, "asc", (t, r) => (t.pitching.eraRank = r));

    // League averages, for context on the context.
    const leagueAvg = {
      kRate: avg(list.map((t) => t.hitting.kRate)),
      ops: avg(list.map((t) => t.hitting.ops)),
      runsPerGame: avg(list.map((t) => t.hitting.runsPerGame)),
      k9: avg(list.map((t) => t.pitching.k9)),
      era: avg(list.map((t) => t.pitching.era)),
    };

    // Keyed by full team name so the frontend can join it to game-log opponents.
    const byName = {};
    for (const t of list) byName[t.name] = t;

    // Season stats move slowly — cache hard.
    res.setHeader("Cache-Control", "s-maxage=21600, stale-while-revalidate=86400");

    return res.status(200).json({
      updatedAt: new Date().toISOString(),
      season: Number(season),
      source: "MLB Stats API",
      teamCount: list.length,
      leagueAvg,
      teams: byName,
    });
  } catch (err) {
    return res.status(500).json({
      error: "Could not reach the MLB Stats API.",
      detail: String(err),
    });
  }
}

/* ---------------- helpers ---------------- */

// The stats endpoint can nest splits under one or several stats entries.
function collectSplits(data) {
  const out = [];
  for (const block of data?.stats || []) {
    for (const s of block?.splits || []) out.push(s);
  }
  return out;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function numOrNull(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function rank(list, get, dir, set) {
  const sorted = [...list]
    .filter((t) => get(t) != null)
    .sort((a, b) => (dir === "asc" ? get(a) - get(b) : get(b) - get(a)));
  sorted.forEach((t, i) => set(t, i + 1));
}

function avg(arr) {
  const vals = arr.filter((v) => v != null);
  if (!vals.length) return null;
  return +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(4);
}
