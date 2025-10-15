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
  <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
    <h2 style="color: #fe2681;">New ${body.kind === "quote" ? "Quote Request" : "Contact Message"}</h2>
    <p><strong>Name:</strong> ${body.name || body.fullName || "N/A"}</p>
    <p><strong>Email:</strong> <a href="mailto:${body.email}">${body.email}</a></p>
    <p><strong>Phone:</strong> ${body.phone || "N/A"}</p>

    ${body.kind === "quote" ? `
      <p><strong>Company:</strong> ${body.company || "N/A"}</p>
      <p><strong>Category:</strong> ${body.category || "N/A"}</p>
      <p><strong>Service:</strong> ${body.service || "N/A"}</p>
      <p><strong>Budget:</strong> ${body.budget || "N/A"}</p>
      <p><strong>Timeline:</strong> ${body.timeline || "N/A"}</p>
      <p><strong>Goals:</strong> ${Array.isArray(body.goals) ? body.goals.join(", ") : (body.goals || "N/A")}</p>
      <p><strong>Reference Links:</strong> ${body.references || "N/A"}</p>
      <p><strong>Brief:</strong><br>${body.brief?.replace(/\n/g, "<br>") || "(No brief provided)"}</p>
    ` : `
      <p><strong>Message:</strong><br>${body.message?.replace(/\n/g, "<br>") || "(No message provided)"}</p>
    `}

    <hr style="margin-top: 20px;">
    <p style="font-size: 0.9em; color: #777;">Submitted on ${new Date(body.submittedAt).toLocaleString()}</p>
  </div>
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
