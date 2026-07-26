// api/games.js
//
// Pulls REAL MLB results from the official MLB Stats API.
// Free, no API key needed.
//
// One request grabs the whole league schedule, then we work out
// the last 50 finished games for each of the 30 teams.

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  // Look back far enough that every team has 50+ games.
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - 150);

  const fmt = (d) => d.toISOString().slice(0, 10);

  const scheduleUrl =
    `https://statsapi.mlb.com/api/v1/schedule` +
    `?sportId=1` +
    `&gameType=R` +
    `&startDate=${fmt(start)}` +
    `&endDate=${fmt(today)}`;

  const teamsUrl = `https://statsapi.mlb.com/api/v1/teams?sportId=1`;

  try {
    const [schedRes, teamsRes] = await Promise.all([
      fetch(scheduleUrl),
      fetch(teamsUrl),
    ]);

    if (!schedRes.ok || !teamsRes.ok) {
      return res.status(502).json({ error: "MLB Stats API did not respond properly." });
    }

    const sched = await schedRes.json();
    const teamsData = await teamsRes.json();

    // Build a lookup: team id -> { abbr, name, division }
    const teamInfo = {};
    for (const t of teamsData.teams) {
      teamInfo[t.id] = {
        abbr: t.abbreviation,
        name: t.name,
        division: t.division?.name || "",
        league: t.league?.name || "",
      };
    }

    // Collect finished games per team.
    const byTeam = {};
    const ensure = (id) => {
      if (!byTeam[id]) byTeam[id] = [];
      return byTeam[id];
    };

    for (const day of sched.dates || []) {
      for (const game of day.games || []) {
        // Only completed regular-season games with a score.
        if (game.status?.abstractGameState !== "Final") continue;

        const home = game.teams?.home;
        const away = game.teams?.away;
        if (!home?.team?.id || !away?.team?.id) continue;
        if (home.score == null || away.score == null) continue;

        const date = game.officialDate || day.date;

        ensure(home.team.id).push({
          date,
          gamePk: game.gamePk,
          opponent: teamInfo[away.team.id]?.abbr || "???",
          isHome: true,
          runsFor: home.score,
          runsAgainst: away.score,
          win: home.score > away.score,
          venue: game.venue?.name || "",
        });

        ensure(away.team.id).push({
          date,
          gamePk: game.gamePk,
          opponent: teamInfo[home.team.id]?.abbr || "???",
          isHome: false,
          runsFor: away.score,
          runsAgainst: home.score,
          win: away.score > home.score,
          venue: game.venue?.name || "",
        });
      }
    }

    // Sort each team's games oldest -> newest, keep the last 50, add summary stats.
    const teams = {};
    for (const [id, games] of Object.entries(byTeam)) {
      const info = teamInfo[id];
      if (!info) continue;

      games.sort((a, b) => a.date.localeCompare(b.date));
      const last50 = games.slice(-50);

      const wins = last50.filter((g) => g.win).length;
      const runsFor = last50.reduce((s, g) => s + g.runsFor, 0);
      const runsAgainst = last50.reduce((s, g) => s + g.runsAgainst, 0);

      // Current streak, counted back from the most recent game.
      let streak = 0;
      let streakType = null;
      for (let i = last50.length - 1; i >= 0; i--) {
        if (streakType === null) {
          streakType = last50[i].win ? "W" : "L";
          streak = 1;
        } else if ((last50[i].win ? "W" : "L") === streakType) {
          streak++;
        } else break;
      }

      teams[info.abbr] = {
        id: Number(id),
        abbr: info.abbr,
        name: info.name,
        division: info.division,
        league: info.league,
        gamesCounted: last50.length,
        wins,
        losses: last50.length - wins,
        winPct: last50.length ? +(wins / last50.length).toFixed(3) : 0,
        runsFor,
        runsAgainst,
        runDiff: runsFor - runsAgainst,
        avgRunsFor: last50.length ? +(runsFor / last50.length).toFixed(2) : 0,
        avgRunsAgainst: last50.length ? +(runsAgainst / last50.length).toFixed(2) : 0,
        streak: streakType ? `${streakType}${streak}` : "—",
        games: last50,
      };
    }

    // Cache for 10 minutes — results don't change often.
    res.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=1800");

    return res.status(200).json({
      updatedAt: new Date().toISOString(),
      source: "MLB Stats API",
      teamCount: Object.keys(teams).length,
      teams,
    });
  } catch (err) {
    return res.status(500).json({
      error: "Could not reach the MLB Stats API.",
      detail: String(err),
    });
  }
}
