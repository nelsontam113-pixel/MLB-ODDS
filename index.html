// api/matchup.js
//
// Batter vs pitcher comparison from the MLB Stats API. Free, no key.
//
// TWO MODES:
//   /api/matchup?slate=1                    -> today + tomorrow's games with probable starters
//   /api/matchup?batter=592450&pitcher=668678 -> the head-to-head comparison
//
// The comparison returns three things:
//   h2h     — career plate appearances between these two specific players
//   batter  — season line plus splits vs LHP and vs RHP
//   pitcher — season line plus splits vs LHB and vs RHB
//
// IMPORTANT: h2h samples are almost always tiny. A 4-for-11 career record is
// eleven plate appearances, which tells you close to nothing. The platoon
// splits carry far more weight. The response includes a reliability flag so
// the UI can say so plainly.

const SEASON = new Date().getFullYear();

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { slate, batter, pitcher, season = SEASON } = req.query;

  try {
    if (slate) return await sendSlate(res);
    if (batter && pitcher) return await sendMatchup(res, batter, pitcher, season);

    return res.status(400).json({
      error: "Tell me what you want.",
      usage: {
        slate: "/api/matchup?slate=1",
        comparison: "/api/matchup?batter=592450&pitcher=668678",
      },
    });
  } catch (err) {
    return res.status(500).json({
      error: "Could not reach the MLB Stats API.",
      detail: String(err),
    });
  }
}

/* ---------------- upcoming slate ---------------- */

async function sendSlate(res) {
  const today = new Date();
  const end = new Date(today);
  end.setDate(end.getDate() + 2);
  const fmt = (d) => d.toISOString().slice(0, 10);

  const fields = [
    "dates", "date", "games", "gamePk", "gameDate", "officialDate", "status", "detailedState",
    "teams", "home", "away", "team", "id", "name", "abbreviation",
    "probablePitcher", "fullName", "pitchHand", "code", "venue",
  ].join(",");

  const url =
    `https://statsapi.mlb.com/api/v1/schedule` +
    `?sportId=1&startDate=${fmt(today)}&endDate=${fmt(end)}` +
    `&hydrate=probablePitcher(person)&fields=${fields}`;

  const r = await fetch(url);
  if (!r.ok) {
    return res.status(502).json({ error: "Couldn't load the schedule.", status: r.status });
  }
  const data = await r.json();

  const games = [];
  for (const day of data.dates || []) {
    for (const g of day.games || []) {
      games.push({
        gamePk: g.gamePk,
        date: g.officialDate || day.date,
        startTime: g.gameDate || null,
        status: g.status?.detailedState || "",
        venue: g.venue?.name || null,
        venueId: g.venue?.id ?? null,
        home: {
          teamId: g.teams?.home?.team?.id ?? null,
          team: g.teams?.home?.team?.name || "",
          starterId: g.teams?.home?.probablePitcher?.id ?? null,
          starter: g.teams?.home?.probablePitcher?.fullName || null,
          throws: g.teams?.home?.probablePitcher?.pitchHand?.code || null,
        },
        away: {
          teamId: g.teams?.away?.team?.id ?? null,
          team: g.teams?.away?.team?.name || "",
          starterId: g.teams?.away?.probablePitcher?.id ?? null,
          starter: g.teams?.away?.probablePitcher?.fullName || null,
          throws: g.teams?.away?.probablePitcher?.pitchHand?.code || null,
        },
      });
    }
  }

  games.sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)));

  res.setHeader("Cache-Control", "s-maxage=900, stale-while-revalidate=3600");

  return res.status(200).json({
    updatedAt: new Date().toISOString(),
    gameCount: games.length,
    withBothStarters: games.filter((g) => g.home.starterId && g.away.starterId).length,
    games,
  });
}

/* ---------------- batter vs pitcher ---------------- */

async function sendMatchup(res, batterId, pitcherId, season) {
  const h2hUrl =
    `https://statsapi.mlb.com/api/v1/people/${batterId}/stats` +
    `?stats=vsPlayerTotal&group=hitting&opposingPlayerId=${pitcherId}`;

  const batterSeasonUrl =
    `https://statsapi.mlb.com/api/v1/people/${batterId}/stats` +
    `?stats=season&group=hitting&season=${season}`;

  const batterSplitsUrl =
    `https://statsapi.mlb.com/api/v1/people/${batterId}/stats` +
    `?stats=statSplits&sitCodes=vl,vr&group=hitting&season=${season}`;

  const pitcherSeasonUrl =
    `https://statsapi.mlb.com/api/v1/people/${pitcherId}/stats` +
    `?stats=season&group=pitching&season=${season}`;

  const pitcherSplitsUrl =
    `https://statsapi.mlb.com/api/v1/people/${pitcherId}/stats` +
    `?stats=statSplits&sitCodes=vl,vr&group=pitching&season=${season}`;

  const peopleUrl =
    `https://statsapi.mlb.com/api/v1/people?personIds=${batterId},${pitcherId}` +
    `&fields=people,id,fullName,batSide,pitchHand,code,primaryPosition,abbreviation,currentTeam,name`;

  const [h2hR, bSeasonR, bSplitR, pSeasonR, pSplitR, peopleR] = await Promise.all([
    fetch(h2hUrl), fetch(batterSeasonUrl), fetch(batterSplitsUrl),
    fetch(pitcherSeasonUrl), fetch(pitcherSplitsUrl), fetch(peopleUrl),
  ]);

  const j = async (r) => (r.ok ? r.json() : null);
  const [h2hD, bSeasonD, bSplitD, pSeasonD, pSplitD, peopleD] = await Promise.all([
    j(h2hR), j(bSeasonR), j(bSplitR), j(pSeasonR), j(pSplitR), j(peopleR),
  ]);

  const people = {};
  for (const p of peopleD?.people || []) people[p.id] = p;

  const batterInfo = people[batterId] || {};
  const pitcherInfo = people[pitcherId] || {};

  // ---- head to head ----
  const h2hSplit = firstSplit(h2hD);
  const h2hStat = h2hSplit?.stat || {};
  const pa = num(h2hStat.plateAppearances);

  const h2h = {
    plateAppearances: pa,
    atBats: num(h2hStat.atBats),
    hits: num(h2hStat.hits),
    homeRuns: num(h2hStat.homeRuns),
    strikeOuts: num(h2hStat.strikeOuts),
    baseOnBalls: num(h2hStat.baseOnBalls),
    rbi: num(h2hStat.rbi),
    avg: h2hStat.avg ?? null,
    ops: h2hStat.ops ?? null,
    // Honest labelling of how much weight this deserves.
    reliability:
      pa >= 50 ? "moderate" : pa >= 20 ? "weak" : pa > 0 ? "negligible" : "none",
    note:
      pa === 0
        ? "These two have never faced each other."
        : pa < 20
        ? `Only ${pa} career plate appearances. Far too few to draw a conclusion from — treat as trivia, not evidence.`
        : pa < 50
        ? `${pa} career plate appearances. Still a small sample; the platoon splits below are more informative.`
        : `${pa} career plate appearances. Unusually large for a batter-pitcher pair, but still smaller than a season split.`,
  };

  // ---- season lines ----
  const bSeason = statOf(bSeasonD, [
    "plateAppearances", "atBats", "hits", "homeRuns", "rbi", "runs",
    "strikeOuts", "baseOnBalls", "avg", "obp", "slg", "ops",
  ]);

  const pSeason = statOf(pSeasonD, [
    "inningsPitched", "strikeOuts", "baseOnBalls", "hits", "homeRuns",
    "earnedRuns", "era", "whip", "avg", "gamesStarted",
  ]);

  // ---- platoon splits ----
  const bSplits = splitsByCode(bSplitD, [
    "plateAppearances", "hits", "homeRuns", "strikeOuts", "baseOnBalls",
    "avg", "obp", "slg", "ops",
  ]);

  const pSplits = splitsByCode(pSplitD, [
    "battersFaced", "inningsPitched", "strikeOuts", "baseOnBalls",
    "hits", "homeRuns", "avg", "ops", "era",
  ]);

  const bats = batterInfo.batSide?.code || null;
  const throws = pitcherInfo.pitchHand?.code || null;

  // Which split of each player is the relevant one tonight?
  const batterRelevant = throws === "L" ? "vl" : throws === "R" ? "vr" : null;
  const pitcherRelevant = bats === "L" ? "vl" : bats === "R" ? "vr" : null;

  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=21600");

  return res.status(200).json({
    updatedAt: new Date().toISOString(),
    season: Number(season),
    source: "MLB Stats API",
    batter: {
      id: Number(batterId),
      name: batterInfo.fullName || "",
      team: batterInfo.currentTeam?.name || "",
      position: batterInfo.primaryPosition?.abbreviation || "",
      bats,
      season: bSeason,
      splits: bSplits,
      relevantSplit: batterRelevant,
    },
    pitcher: {
      id: Number(pitcherId),
      name: pitcherInfo.fullName || "",
      team: pitcherInfo.currentTeam?.name || "",
      throws,
      season: pSeason,
      splits: pSplits,
      relevantSplit: pitcherRelevant,
    },
    platoon: {
      bats,
      throws,
      // Switch hitters bat opposite the pitcher, so they always hold the edge.
      batterAdvantage: bats === "S" ? true : bats && throws ? bats !== throws : null,
      label:
        bats && throws
          ? bats === "S"
            ? "Switch hitter — bats opposite the pitcher, so holds the platoon edge"
            : bats !== throws
            ? "Batter holds the platoon edge (opposite hands)"
            : "Pitcher holds the platoon edge (same hand)"
          : "Handedness unavailable",
    },
    h2h,
  });
}

/* ---------------- helpers ---------------- */

function firstSplit(data) {
  for (const block of data?.stats || []) {
    for (const s of block?.splits || []) return s;
  }
  return null;
}

function statOf(data, keys) {
  const s = firstSplit(data);
  if (!s) return null;
  const st = s.stat || {};
  const out = {};
  for (const k of keys) out[k] = st[k] ?? null;
  return out;
}

// statSplits returns one entry per sitCode; key them by code (vl / vr).
function splitsByCode(data, keys) {
  const out = {};
  for (const block of data?.stats || []) {
    for (const s of block?.splits || []) {
      const code = s.split?.code;
      if (!code) continue;
      const st = s.stat || {};
      const row = {};
      for (const k of keys) row[k] = st[k] ?? null;
      row.label = s.split?.description || code;
      out[code] = row;
    }
  }
  return out;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
