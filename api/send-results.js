// api/send-results.js
// Sends a scenario results summary email via Resend
// Free tier: 3,000 emails/month

export const config = { runtime: "edge" };

const RESEND_API = "https://api.resend.com/emails";

export default async function handler(req) {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const { email, scenario, risk, results, subscribe } = await req.json();

    if (!email || !email.includes("@")) {
      return new Response(JSON.stringify({ error: "Invalid email" }), { status: 400 });
    }

    const scenarioLabels = {
      home: "Home Purchase",
      car: "Car / Lease",
      job: "Job Change",
      apt: "New Apartment",
      daycare: "Daycare",
      savings: "Savings Goal",
    };

    const scenarioLabel = scenarioLabels[scenario] || "Scenario";
    const isEstimate = risk === "ESTIMATE";

    const riskColor  = isEstimate ? "#4338CA" : risk === "SAFE" ? "#059669" : risk === "STRETCH" ? "#92400e" : "#991b1b";
    const verdictBg  = isEstimate ? "#EEF2FF" : risk === "SAFE" ? "#dcfce7"  : risk === "STRETCH" ? "#fef9c3"  : "#fee2e2";
    const verdictBdr = isEstimate ? "#C7D2FE" : risk === "SAFE" ? "#86efac"  : risk === "STRETCH" ? "#fde047"  : "#fca5a5";
    const verdictWord = isEstimate ? "Cost Estimate" : risk === "SAFE" ? "Safe" : risk === "STRETCH" ? "Stretch" : "Risky";
    const verdictIcon = isEstimate ? "\uD83C\uDFE0" : risk === "SAFE" ? "\u2756" : risk === "STRETCH" ? "\u25C8" : "\u25C6";

    const lines = (results || "").split("\n").filter(Boolean);
    const summaryLine = (lines.find(l => l.startsWith("Summary:")) || "").replace("Summary: ", "");
    const skipPrefixes = ["Scenario:", "Verdict:", "Summary:"];
    const detailLines = lines.filter(l => !skipPrefixes.some(p => l.startsWith(p)));

    let tableRows = "";
    for (const line of detailLines) {
      const colonIdx = line.indexOf(": ");
      if (colonIdx === -1) continue;
      const label = line.substring(0, colonIdx);
      const value = line.substring(colonIdx + 2);
      tableRows += "<tr>";
      tableRows += "<td style='padding:11px 0;font-size:13px;color:#4B5563;font-weight:600;border-bottom:1px solid #F3F4F6;width:55%'>" + label + "</td>";
      tableRows += "<td style='padding:11px 0;font-size:14px;color:#111;font-weight:800;text-align:right;border-bottom:1px solid #F3F4F6;font-family:monospace'>" + value + "</td>";
      tableRows += "</tr>";
    }

    const summaryHtml = summaryLine
      ? "<div style='font-size:13px;color:" + riskColor + ";opacity:0.85;font-weight:500;line-height:1.6;padding-top:10px;border-top:1px solid " + verdictBdr + "'>" + summaryLine + "</div>"
      : "";

    const subscribeHtml = subscribe
      ? "<div>You're subscribed to updates from canweaffordthis.com.</div>"
      : "";

    const html = "<!DOCTYPE html><html><head><meta charset='utf-8'/></head>" +
      "<body style='margin:0;padding:0;background:#F0F0EE;font-family:Helvetica,Arial,sans-serif'>" +
      "<div style='max-width:520px;margin:0 auto;padding:32px 16px'>" +

      "<div style='background:#34D399;border-radius:16px 16px 0 0;padding:22px 28px 20px'>" +
      "<div style='font-size:11px;font-weight:800;color:rgba(0,0,0,0.4);letter-spacing:0.08em;text-transform:uppercase;margin-bottom:4px'>Can We Afford This?</div>" +
      "<div style='font-size:22px;font-weight:900;color:#fff;letter-spacing:-0.02em'>" + scenarioLabel + (isEstimate ? " Cost Estimate" : " Results") + "</div>" +
      "</div>" +

      "<div style='background:" + verdictBg + ";border:2px solid " + verdictBdr + ";border-top:none;padding:20px 28px 18px'>" +
      "<div style='font-size:9px;font-weight:800;color:" + riskColor + ";opacity:0.65;letter-spacing:0.16em;text-transform:uppercase;margin-bottom:8px'>Verdict</div>" +
      "<div style='font-size:32px;font-weight:900;color:" + riskColor + ";letter-spacing:-0.02em;line-height:1;margin-bottom:10px'>" + verdictIcon + " " + verdictWord + "</div>" +
      summaryHtml +
      "</div>" +

      "<div style='background:#fff;border-radius:0 0 16px 16px;padding:4px 28px 24px;box-shadow:0 4px 20px rgba(0,0,0,0.07)'>" +
      "<div style='font-size:9px;font-weight:800;color:#9CA3AF;letter-spacing:0.1em;text-transform:uppercase;padding:16px 0 4px'>Your Numbers</div>" +
      "<table style='width:100%;border-collapse:collapse'>" + tableRows + "</table>" +
      "</div>" +

      "<div style='background:#fff;border-radius:16px;padding:20px 28px;margin-top:12px;box-shadow:0 4px 20px rgba(0,0,0,0.07)'>" +
      "<div style='font-size:13px;color:#4B5563;font-weight:500;line-height:1.6;margin-bottom:16px'>Run your scenario again to see the full stress test, before vs. after cash flow, and what you could comfortably afford.</div>" +
      "<a href='https://canweaffordthis.com' style='display:inline-block;background:#4338CA;color:#fff;text-decoration:none;padding:12px 24px;border-radius:11px;font-size:13px;font-weight:800'>Run another scenario</a>" +
      "</div>" +

      "<div style='text-align:center;margin-top:20px;font-size:11px;color:#9CA3AF;line-height:1.7'>" +
      subscribeHtml +
      "<div>Cash-flow analysis - not financial advice. Consult a financial advisor before major decisions.</div>" +
      "<a href='https://canweaffordthis.com' style='color:#C4C4C4;text-decoration:none'>canweaffordthis.com</a>" +
      "</div>" +

      "</div></body></html>";

    const res = await fetch(RESEND_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + (process.env.RESEND_API_KEY || ""),
      },
      body: JSON.stringify({
        from: "Can We Afford This? <results@canweaffordthis.com>",
        to: [email],
        subject: (isEstimate ? "Your " + scenarioLabel + " Cost Estimate" : "Your " + scenarioLabel + " Results") + " - Can We Afford This?",
        html,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("Resend error:", err);
      return new Response(JSON.stringify({ error: "Email failed" }), { status: 500 });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("send-results error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
