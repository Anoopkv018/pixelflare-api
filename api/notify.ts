/// <reference types="node" />
import nodemailer from "nodemailer";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import formidable, { File } from "formidable";
import fs from "fs";

// Disable Next.js body parser to handle FormData uploads
export const config = {
  api: {
    bodyParser: false,
  },
};

// Utility to promisify formidable parsing (important on Vercel)
function parseForm(req: any): Promise<{ fields: any; files: any }> {
  const form = formidable({ multiples: false });
  return new Promise((resolve, reject) => {
    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      else resolve({ fields, files });
    });
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOW_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  try {
    const { fields, files } = await parseForm(req);
    const body: Record<string, any> = {};
    for (const [k, v] of Object.entries(fields)) {
      body[k] = Array.isArray(v) ? v[0] : v;
    }

    const file: File | undefined = Array.isArray(files.attachment)
      ? files.attachment[0]
      : (files.attachment as File | undefined);

    if (!body.kind || !body.email)
      return res.status(400).json({ success: false, error: "Missing required fields" });

    // Build attachment array if file exists
    const attachments = [];
    if (file && fs.existsSync(file.filepath)) {
      const fileBuffer = fs.readFileSync(file.filepath);
      attachments.push({
        filename: file.originalFilename || "attachment",
        content: fileBuffer,
      });
      console.log("📎 Attachment added:", file.originalFilename);
    } else {
      console.log("⚠️ No attachment found");
    }

    // Create SMTP transporter
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 465,
      secure: true,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    // HTML body
    const html = `
    <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
      <h2 style="color: #fe2681;">New ${
        body.kind === "quote" ? "Quote Request" : "Contact Message"
      }</h2>
      <p><strong>Name:</strong> ${body.name || body.fullName || "N/A"}</p>
      <p><strong>Email:</strong> ${body.email}</p>
      <p><strong>Phone:</strong> ${body.phone || "N/A"}</p>
      ${
        body.kind === "quote"
          ? `
        <p><strong>Service:</strong> ${body.service || "N/A"}</p>
        <p><strong>Budget:</strong> ${body.budget || "N/A"}</p>
        <p><strong>Brief:</strong><br>${body.brief?.replace(/\n/g, "<br>") || "(none)"}</p>`
          : `<p><strong>Message:</strong><br>${body.message || "(none)"}</p>`
      }
      ${file ? `<p><strong>Attachment:</strong> ${file.originalFilename}</p>` : ""}
    </div>
    `;

    // Send email
    const info = await transporter.sendMail({
      from: process.env.MAIL_FROM,
      to: process.env.MAIL_TO,
      cc: process.env.MAIL_CC || undefined,
      subject:
        body.kind === "quote" ? "New Quote Request" : "New Contact Message",
      html,
      attachments,
    });

    console.log("✅ Email sent:", info.messageId);
    return res.status(200).json({ success: true, messageId: info.messageId });
  } catch (err: any) {
    console.error("❌ Email send error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
}
