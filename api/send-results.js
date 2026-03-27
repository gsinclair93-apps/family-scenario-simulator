// api/send-results.js
// Sends a scenario results summary email via Resend
// Free tier: 3,000 emails/month — well within limits at current traffic

export const config = { runtime: "edge" };

const RESEND_API = "https://api.resend.com/emails";

export default async function handler(req) {
  if(req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const { email, scenario, risk, results, subscribe } = await req.json();

    if(!email || !email.includes("@")) {
      return new Response(JSON.stringify({ error: "Invalid email" }), { status: 400 });
    }

    // Scenario labels
    const scenarioLabels = {
      home: "Home Purchase",
      car: "Car / Lease",
      job: "Job Change",
      apt: "New Apartment",
      daycare: "Daycare",
      savings: "Savings Goal",
    };

    const riskColors = {
      SAFE: "#059669",
      STRETCH: "#D97706",
      RISKY: "#DC2626",
    };

    const scenarioLabel = scenarioLabels[scenario] || "Scenario";
    const riskColor = riskColors[risk] || "#374151";

    // Format results lines into HTML rows
    const resultLines = (results || "").split("\n").filter(Boolean);
    const resultRows = resultLines
      .slice(2) // skip scenario + verdict lines — shown in header
      .map(line => {
        const [label, ...rest] = line.split(": ");
        return `
          <tr>
            <td style="padding:8px 0;font-size:14px;color:#4B5563;font-weight:600;border-bottom:1px solid #F3F4F6">${label}</td>
            <td style="padding:8px 0;font-size:14px;color:#111;font-weight:800;text-align:right;border-bottom:1px solid #F3F4F6;font-family:monospace">${rest.join(": ")}</td>
          </tr>`;
      }).join("");

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
</head>
<body style="margin:0;padding:0;background:#F0F0EE;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif">
  <div style="max-width:520px;margin:0 auto;padding:32px 16px">

    <!-- Header -->
    <div style="background:#34D399;border-radius:16px 16px 0 0;padding:24px 28px">
      <div style="font-size:13px;font-weight:800;color:rgba(255,255,255,0.75);letter-spacing:0.05em;text-transform:uppercase;margin-bottom:4px">Can We Afford This?</div>
      <div style="font-size:22px;font-weight:900;color:#fff;letter-spacing:-0.02em">${scenarioLabel} Results</div>
    </div>

    <!-- Verdict -->
    <div style="background:#fff;padding:20px 28px;border-left:4px solid ${riskColor}">
      <div style="font-size:10px;font-weight:800;color:#9CA3AF;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:6px">Verdict</div>
      <div style="font-size:28px;font-weight:900;color:${riskColor};letter-spacing:-0.02em">${risk.charAt(0) + risk.slice(1).toLowerCase()}</div>
    </div>

    <!-- Results table -->
    <div style="background:#fff;padding:4px 28px 24px;border-radius:0 0 16px 16px;box-shadow:0 4px 20px rgba(0,0,0,0.08)">
      <table style="width:100%;border-collapse:collapse">
        ${resultRows}
      </table>
    </div>

    <!-- CTA -->
    <div style="text-align:center;margin-top:24px;padding:0 8px">
      <a href="https://canweaffordthis.com" style="display:inline-block;background:#4338CA;color:#fff;text-decoration:none;padding:13px 28px;border-radius:12px;font-size:14px;font-weight:800;letter-spacing:-0.01em">
        Run another scenario →
      </a>
    </div>

    <!-- Footer -->
    <div style="text-align:center;margin-top:20px;font-size:11px;color:#9CA3AF;line-height:1.6">
      ${subscribe ? "You're subscribed to updates from canweaffordthis.com.<br/>" : ""}
      Cash-flow analysis — not financial advice. Consult a financial advisor before major decisions.<br/>
      <a href="https://canweaffordthis.com" style="color:#9CA3AF">canweaffordthis.com</a>
    </div>

  </div>
</body>
</html>`;

    const res = await fetch(RESEND_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: "Can We Afford This? <results@canweaffordthis.com>",
        to: [email],
        subject: `Your ${scenarioLabel} Results — Can We Afford This?`,
        html,
      }),
    });

    if(!res.ok) {
      const err = await res.text();
      console.error("Resend error:", err);
      return new Response(JSON.stringify({ error: "Email failed" }), { status: 500 });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  } catch(err) {
    console.error("send-results error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
