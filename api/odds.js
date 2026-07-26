// api/odds.js
//
// This is your "middleman". Your website talks to this file.
// This file talks to The Odds API using your secret key.
// The key lives here on the server, so visitors to your site never see it.

export default async function handler(req, res) {
  // Allow your website to call this from a browser.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const API_KEY = process.env.ODDS_API_KEY;

  if (!API_KEY) {
    return res.status(500).json({
      error: "No API key found. Add ODDS_API_KEY in your Vercel project settings.",
    });
  }

  // Which sportsbooks and bet types we want back.
  const bookmakers = "draftkings,fanduel";
  const markets = "h2h,spreads,totals"; // moneyline, run line, over/under
  const sport = "baseball_mlb";

  const url =
    `https://api.the-odds-api.com/v4/sports/${sport}/odds` +
    `?regions=us` +
    `&bookmakers=${bookmakers}` +
    `&markets=${markets}` +
    `&oddsFormat=american` +
    `&apiKey=${API_KEY}`;

  try {
    const response = await fetch(url);

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({
        error: "The Odds API refused the request.",
        detail: text,
      });
    }

    const data = await response.json();

    // Reshape it into something simple for the website to read.
    const games = data.map((game) => {
      const books = {};

      for (const bookmaker of game.bookmakers) {
        const out = { moneyline: {}, runLine: {}, total: {} };

        for (const market of bookmaker.markets) {
          if (market.key === "h2h") {
            for (const o of market.outcomes) {
              out.moneyline[o.name] = o.price;
            }
          }
          if (market.key === "spreads") {
            for (const o of market.outcomes) {
              out.runLine[o.name] = { line: o.point, odds: o.price };
            }
          }
          if (market.key === "totals") {
            for (const o of market.outcomes) {
              out.total[o.name] = { line: o.point, odds: o.price };
            }
          }
        }

        books[bookmaker.key] = out;
      }

      return {
        id: game.id,
        startTime: game.commence_time,
        homeTeam: game.home_team,
        awayTeam: game.away_team,
        books,
      };
    });

    // Tell browsers to reuse this answer for 60 seconds.
    // This protects your monthly request quota.
   res.setHeader("Cache-Control", "s-maxage=900, stale-while-revalidate=3600");

    // How many requests you have left this month.
    const remaining = response.headers.get("x-requests-remaining");

    return res.status(200).json({
      updatedAt: new Date().toISOString(),
      requestsRemaining: remaining,
      games,
    });
  } catch (err) {
    return res.status(500).json({
      error: "Could not reach The Odds API.",
      detail: String(err),
    });
  }
}
