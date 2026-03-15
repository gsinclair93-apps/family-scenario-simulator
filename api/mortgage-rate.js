// api/mortgage-rate.js
// Fetches the current 30-year fixed mortgage rate from FRED (Federal Reserve)
// Updates every Thursday. Cached at the edge for 24 hours.

export const config = { runtime: "edge" };

const FRED_URL =
  "https://fred.stlouisfed.org/graph/fredgraph.csv?id=MORTGAGE30US";

export default async function handler(req) {
  try {
    const res = await fetch(FRED_URL, {
      headers: { "User-Agent": "canweaffordthis.com/mortgage-rate-fetch" },
    });

    if (!res.ok) throw new Error(`FRED responded with ${res.status}`);

    const text = await res.text();

    // CSV format: DATE,VALUE\n2024-01-01,6.62\n...
    // Last non-empty line is the most recent data point
    const lines = text.trim().split("\n").filter(Boolean);
    const lastLine = lines[lines.length - 1];
    const [date, value] = lastLine.split(",");

    const rate = parseFloat(value);
    if (isNaN(rate)) throw new Error("Could not parse rate from FRED data");

    return new Response(
      JSON.stringify({ rate, date, source: "FRED/Freddie Mac" }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          // Cache at edge for 24 hours, allow stale for another 24 while revalidating
          "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=86400",
        },
      }
    );
  } catch (err) {
    // Return error — app will leave field empty so user must input their own rate
    return new Response(
      JSON.stringify({ error: err.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
