// api/leads.js
// Vercel serverless function — appends lead data to a Google Sheet.
// Requires these environment variables set in Vercel dashboard:
//   GOOGLE_SHEET_ID        — the ID from your sheet's URL
//   GOOGLE_CLIENT_EMAIL    — from your service account JSON
//   GOOGLE_PRIVATE_KEY     — from your service account JSON (include the full key with \n)

export default async function handler(req, res) {
  if(req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { email, scenario, risk, timestamp } = req.body;

  if(!email || !email.includes("@")) {
    return res.status(400).json({ error: "Invalid email" });
  }

  try {
    // Build JWT for Google Sheets API auth
    const jwtToken = await getGoogleJWT();
    const accessToken = await getAccessToken(jwtToken);

    const sheetId = process.env.GOOGLE_SHEET_ID;
    const range = "Sheet1!A:D"; // columns: Timestamp, Email, Scenario, Risk

    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}:append?valueInputOption=RAW`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          values: [[timestamp, email, scenario, risk]],
        }),
      }
    );

    if(!response.ok) {
      const err = await response.text();
      console.error("Sheets error:", err);
      return res.status(502).json({ error: "Failed to write to sheet" });
    }

    return res.status(200).json({ ok: true });

  } catch(err) {
    console.error("Leads error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

// ── Google JWT helpers ──────────────────────────────────────────────────────
async function getGoogleJWT() {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: process.env.GOOGLE_CLIENT_EMAIL,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };

  const enc = obj => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const unsigned = `${enc(header)}.${enc(payload)}`;

  // Import the private key
  const privateKey = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n");
  const keyData = privateKey
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");

  const binaryKey = Buffer.from(keyData, "base64");
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    Buffer.from(unsigned)
  );

  return `${unsigned}.${Buffer.from(signature).toString("base64url")}`;
}

async function getAccessToken(jwt) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const data = await res.json();
  if(!data.access_token) throw new Error("Failed to get access token");
  return data.access_token;
}
