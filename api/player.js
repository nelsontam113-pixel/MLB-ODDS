// api/player.js
//
// Player-level MLB data from the official Stats API. Free, no key.
//
// TWO MODES:
//   /api/player?team=NYY                        -> active roster with player IDs
//   /api/player?id=592450&group=hitting         -> that player's game-by-game log
//   /api/player?id=592450&group=pitching        -> same, for pitchers
//
// The game log includes last-5 / last-10 / last-15 / season averages, which is
// the bit that actually matters for prop research.

const SEASON = new Date().getFullYear();

// Stats we pull out of each game, by group.
const HITTING_KEYS = [
  "atBats", "hits", "doubles", "triples", "homeRuns", "rbi", "runs",
  "baseOnBalls", "strikeOuts", "stolenBases", "totalBases",
];

const PITCHING_KEYS = [
  "inningsPitched", "strikeOuts", "hits", "runs", "earnedRuns",
  "baseOnBalls", "homeRuns", "numberOfPitches", "battersFaced",
];

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { team, id, group = "hitting", season = SEASON } = req.query;

  try {
    if (team) return await sendRoster(res, String(team).toUpperCase());
    if (id) return await sendGameLog(res, id, group, season);

    return res.status(400).json({
      error: "Tell me what you want.",
      usage: {
        roster: "/api/player?team=NYY",
        hitterLog: "/api/player?id=592450&group=hitting",
        pitcherLog: "/api/player?id=592450&group=pitching",
      },
    });
  } catch (err) {
    return res.status(500).json({
      error: "Could not reach the MLB Stats API.",
      detail: String(err),
    });
  }
}

/* ---------------- roster ---------------- */

async function sendRoster(res, abbr) {
  const teamsRes = await fetch(
    "https://statsapi.mlb.com/api/v1/teams?sportId=1&fields=teams,id,name,abbreviation"
  );
  if (!teamsRes.ok) {
    return res.status(502).json({ error: "Couldn't load the team list." });
  }

  const teamsData = await teamsRes.json();
  const match = (teamsData.teams || []).find(
    (t) => (t.abbreviation || "").toUpperCase() === abbr
  );

  if (!match) {
    return res.status(404).json({
      error: `No team with abbreviation "${abbr}".`,
      hint: "Use codes like NYY, LAD, BOS.",
    });
  }

  const rosterRes = await fetch(
    `https://statsapi.mlb.com/api/v1/teams/${match.id}/roster` +
      `?rosterType=active&fields=roster,person,id,fullName,position,abbreviation,name`
  );
  if (!rosterRes.ok) {
    return res.status(502).json({ error: "Couldn't load that roster." });
  }

  const rosterData = await rosterRes.json();

  const players = (rosterData.roster || []).map((r) => ({
    id: r.person?.id,
    name: r.person?.fullName,
    position: r.position?.abbreviation || "",
    positionName: r.position?.name || "",
    isPitcher: (r.position?.abbreviation || "") === "P",
  }));

  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");

  return res.status(200).json({
    team: { abbr: match.abbreviation, name: match.name, id: match.id },
    playerCount: players.length,
    pitchers: players.filter((p) => p.isPitcher),
    batters: players.filter((p) => !p.isPitcher),
  });
}

/* ---------------- game log ---------------- */

async function sendGameLog(res, id, group, season) {
  const g = group === "pitching" ? "pitching" : "hitting";
  const keys = g === "pitching" ? PITCHING_KEYS : HITTING_KEYS;

  const [logRes, personRes] = await Promise.all([
    fetch(
      `https://statsapi.mlb.com/api/v1/people/${id}/stats` +
        `?stats=gameLog&group=${g}&season=${season}`
    ),
    fetch(
      `https://statsapi.mlb.com/api/v1/people/${id}` +
        `?fields=people,id,fullName,primaryPosition,abbreviation,currentTeam,name`
    ),
  ]);

  if (!logRes.ok) {
    return res.status(502).json({
      error: "Couldn't load that game log.",
      status: logRes.status,
    });
  }

  const logData = await logRes.json();
  const personData = personRes.ok ? await personRes.json() : null;
  const person = personData?.people?.[0] || null;

  const splits = logData.stats?.[0]?.splits || [];

  if (!splits.length) {
    return res.status(200).json({
      player: person
        ? { id: person.id, name: person.fullName }
        : { id: Number(id) },
      group: g,
      season: Number(season),
      gameCount: 0,
      games: [],
      note: "No games found. Wrong group for this player, or no appearances yet this season.",
    });
  }

  // Oldest -> newest
  const games = splits
    .map((s) => {
      const stat = s.stat || {};
      const row = {
        date: s.date,
        opponent: s.opponent?.name || "",
        isHome: s.isHome === true,
      };
      for (const k of keys) {
        row[k] = toNumber(stat[k]);
      }
      return row;
    })
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  // Averages over recent windows — the prop-research part.
  const windows = { last5: 5, last10: 10, last15: 15, season: games.length };
  const averages = {};

  for (const [label, n] of Object.entries(windows)) {
    const slice = games.slice(-n);
    if (!slice.length) continue;
    averages[label] = { games: slice.length };
    for (const k of keys) {
      const vals = slice.map((row) => row[k]).filter((v) => v != null);
      if (!vals.length) continue;
      const sum = vals.reduce((a, b) => a + b, 0);
      averages[label][k] = +(sum / vals.length).toFixed(2);
    }
  }

  res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=7200");

  return res.status(200).json({
    player: person
      ? {
          id: person.id,
          name: person.fullName,
          position: person.primaryPosition?.abbreviation || "",
          team: person.currentTeam?.name || "",
        }
      : { id: Number(id) },
    group: g,
    season: Number(season),
    gameCount: games.length,
    averages,
    games,
  });
}

/* ---------------- helpers ---------------- */

// MLB returns some values as strings ("6.0" innings, "0.311" avg).
function toNumber(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
