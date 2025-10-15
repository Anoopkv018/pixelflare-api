/// <reference types="node" />
import nodemailer from "nodemailer";
import type { VercelRequest, VercelResponse } from '@vercel/node';


// --- Helpers ---
// --- Helpers ---
const esc = (s: string = ""): string =>
  String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c] || c));

const nl2br = (s: string = ""): string =>
  String(s).replace(/\n/g, "<br>");


// --- CORS (allow your Bluehost domain only) ---
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || "*"; // e.g. https://yourdomain.com

function withCORS(res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", ALLOW_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  withCORS(res);
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = req.body || {};
  // Expected shapes:
  // { kind: 'contact', name, email, phone?, message, recaptchaToken? }
  // { kind: 'quote',   fullName, email, phone, company?, category, service, budget?, timeline?, brief, goals?, references?, recaptchaToken? }

  if (!body.kind) {
    return res.status(400).json({ error: "Invalid payload: missing kind" });
  }

  // --- Verify reCAPTCHA v2/v3 token (optional but recommended) ---
  // If you’re using reCAPTCHA v2 checkbox, you’ll POST its token here as body.recaptchaToken.
  // For v3, same idea. If you’re not using reCAPTCHA yet, you can comment this block out.
  try {
    const secret = process.env.RECAPTCHA_SECRET;
    if (secret) {
      const token = body.recaptchaToken;
      if (!token) {
        return res.status(400).json({ error: "Missing reCAPTCHA token" });
      }
      const resp = await fetch("https://www.google.com/recaptcha/api/siteverify", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: `secret=${secret}&response=${token}`,
});

type RecaptchaResponse = {
  success: boolean;
  score?: number;
  "error-codes"?: string[];
};

const data = (await resp.json()) as RecaptchaResponse;

if (!data.success) {
  return res.status(400).json({ error: "reCAPTCHA failed", details: data });
}

      // (optional) for v3 check data.score >= 0.5
    }
  } catch (e) {
    console.error("reCAPTCHA verify error:", e);
    return res.status(400).json({ error: "reCAPTCHA verification error" });
  }

  // --- Nodemailer transporter ---
  const port = Number(process.env.SMTP_PORT || 465);
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,        // smtp.gmail.com
    port,                               // 465 (secure) or 587 (STARTTLS)
    secure: port === 465,               // true for 465
    auth: {
      user: process.env.SMTP_USER,      // your SMTP username (Gmail address)
      pass: process.env.SMTP_PASS       // app password
    }
  });

  // --- Recipients (defaults + env overrides) ---
  const to = process.env.MAIL_TO || "reachpixelflare@gmail.com";
  const cc = (process.env.MAIL_CC || "info@pixelflare.in,services@pixelflare.in")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

  try {
    let subject = "New submission";
    let html = "";

    if (body.kind === "contact") {
      const { name, email, phone, message, submittedAt } = body;
      if (!name || !email || !message) {
        return res.status(400).json({ error: "Missing required fields" });
      }
      subject = `📩 New Contact — ${name}`;
      html = `
        <h2 style="color:#14276d;margin:0 0 12px">New Contact Message</h2>
        <p><b>Name:</b> ${esc(name)}</p>
        <p><b>Email:</b> ${esc(email)}</p>
        <p><b>Phone:</b> ${esc(phone || "N/A")}</p>
        <p><b>Message:</b><br>${nl2br(esc(message))}</p>
        ${submittedAt ? `<p style="color:#666"><small>Submitted: ${esc(submittedAt)}</small></p>` : ""}
      `;
    } else if (body.kind === "quote") {
      const { fullName, email, phone, company, category, service, budget, timeline, brief, goals, references, submittedAt } = body;
      subject = `🧾 New Quote — ${category} / ${service} — ${fullName}`;
      html = `
        <h2 style="color:#14276d;margin:0 0 12px">New Quote Request</h2>
        <p><b>Name:</b> ${esc(fullName)}</p>
        <p><b>Email:</b> ${esc(email)}</p>
        <p><b>Phone:</b> ${esc(phone || "")}</p>
        ${company ? `<p><b>Company:</b> ${esc(company)}</p>` : ""}
        <p><b>Category:</b> ${esc(category)} — <b>Service:</b> ${esc(service)}</p>
        ${budget ? `<p><b>Budget:</b> ${esc(budget)}</p>` : ""}
        ${timeline ? `<p><b>Timeline:</b> ${esc(timeline)}</p>` : ""}
        <p><b>Brief:</b><br>${nl2br(esc(brief || ""))}</p>
        ${Array.isArray(goals) && goals.length ? `<p><b>Goals:</b> ${goals.map(esc).join(", ")}</p>` : ""}
        ${references ? `<p><b>References:</b><br>${nl2br(esc(references))}</p>` : ""}
        ${submittedAt ? `<p style="color:#666"><small>Submitted: ${esc(submittedAt)}</small></p>` : ""}
      `;
    } else {
      return res.status(400).json({ error: "Unknown kind" });
    }

    const fromAddress = process.env.MAIL_FROM || process.env.SMTP_USER || "no-reply@localhost";

    const info = await transporter.sendMail({
      from: `"PixelFlare" <${fromAddress}>`,
      to,
      cc,
      subject,
      html
    });

    return res.status(200).json({ success: true, messageId: info.messageId });
  } catch (err) {
    console.error("Email send failed:", err);
    return res.status(500).json({ success: false, error: "Failed to send email" });
  }
}
