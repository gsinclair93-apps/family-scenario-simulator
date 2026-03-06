// api/categorize.js
// Vercel serverless function — runs on the server, never exposed to the browser.
// The ANTHROPIC_API_KEY environment variable is set in your Vercel dashboard.

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { prompt } = req.body;

  if (!prompt || typeof prompt !== "string") {
    return res.status(400).json({ error: "Missing prompt" });
  }

  // Basic abuse guard — prompts shouldn't be enormous
  if (prompt.length > 20000) {
    return res.status(400).json({ error: "Prompt too large" });
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,  // ← secret, lives only here
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",  // Haiku is faster + cheaper for categorization
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("Anthropic error:", err);
      return res.status(502).json({ error: "Upstream API error" });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || "";

    return res.status(200).json({ text });

  } catch (err) {
    console.error("Proxy error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
