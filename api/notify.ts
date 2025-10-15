/// <reference types="node" />
import nodemailer from "nodemailer";
import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOW_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const body = req.body || {};
    if (!body.kind || !body.name || !body.email) {
      return res.status(400).json({ success: false, error: "Invalid request body" });
    }

    // ---- SMTP setup ----
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 465,
      secure: true,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    // ---- Email content ----
    const html = `
      <h2>New ${body.kind === "quote" ? "Quote Request" : "Contact Message"}</h2>
      <p><strong>Name:</strong> ${body.name}</p>
      <p><strong>Email:</strong> ${body.email}</p>
      <p><strong>Phone:</strong> ${body.phone || "N/A"}</p>
      <p><strong>Message:</strong><br/>${body.message || "(No message provided)"}</p>
    `;

    // ---- Send the email ----
    const info = await transporter.sendMail({
      from: process.env.MAIL_FROM,
      to: process.env.MAIL_TO,
      cc: process.env.MAIL_CC || undefined,
      subject: body.kind === "quote" ? "New Quote Request" : "New Contact Message",
      html,
    });

    console.log("✅ Email sent:", info.messageId);
    return res.status(200).json({ success: true, messageId: info.messageId });
  } catch (err: any) {
    console.error("❌ Email sending error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
}
