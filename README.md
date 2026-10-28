# Sportmonks live football – proof of concept

1. Install Node.js 18+ (https://nodejs.org)
2. `npm install`
3. Copy `.env.example` to `.env` and paste your Sportmonks token
4. `npm start` then open http://localhost:3000

Use "Live now" during match time, or "By date" to test any day (past results include events).
Your token stays on the server and is never sent to the browser.

## Debugging
Add `?raw=1` to any `/api/fixture/:id`, `/api/fixture/:id/stats`, `/api/fixture/:id/lineups` or `/api/standings/:season` URL to see Sportmonks' own response.
