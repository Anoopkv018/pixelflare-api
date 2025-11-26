/// <reference types="node" />
import nodemailer from "nodemailer";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import formidable, { File as FormidableFile } from "formidable";
import fs from "fs";

// Disable body parser so we can handle raw/multipart bodies
export const config = {
  api: {
    bodyParser: false,
  },
};

// ---- Helpers ---------------------------------------------------------

// Promisified formidable for multipart/form-data
function parseForm(req: any): Promise<{ fields: any; files: any }> {
  const form = formidable({ multiples: false });
  return new Promise((resolve, reject) => {
    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      else resolve({ fields, files });
    });
  });
}

// Read raw body and parse JSON (for application/json)
async function parseJsonBody(req: VercelRequest): Promise<any> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of req as any) {
    chunks.push(chunk as Uint8Array);
  }
  const raw = Buffer.concat(chunks).toString("utf8") || "{}";
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.warn("⚠️ Failed to parse JSON body:", e);
    return {};
  }
}

// Check content type
function getContentType(req: VercelRequest): string {
  return (req.headers["content-type"] || "") as string;
}

// ---- Main handler ----------------------------------------------------

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOW_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const contentType = getContentType(req);

    let body: Record<string, any> = {};
    let file: FormidableFile | undefined;

    // ---- If multipart/form-data: use formidable (supports attachments) ----
    if (contentType.startsWith("multipart/form-data")) {
      const { fields, files } = await parseForm(req as any);

      for (const [k, v] of Object.entries(fields)) {
        body[k] = Array.isArray(v) ? v[0] : v;
      }

      const maybeFile = (files as any).attachment;
      file = Array.isArray(maybeFile)
        ? (maybeFile[0] as FormidableFile)
        : (maybeFile as FormidableFile | undefined);

      console.log("📩 Parsed multipart body:", body);
      if (file) {
        console.log("📎 Incoming file:", file.originalFilename, file.mimetype);
      }
    }
    // ---- Otherwise: treat as JSON (current quote/contact forms) ----
    else if (contentType.startsWith("application/json")) {
      body = await parseJsonBody(req);
      file = undefined;
      console.log("📩 Parsed JSON body:", body);
    }
    // Fallback: best-effort JSON
    else {
      body = await parseJsonBody(req);
      file = undefined;
      console.log("📩 Fallback body:", body);
    }

    if (!body.kind || !body.email) {
      return res
        .status(400)
        .json({ success: false, error: "Missing required fields" });
    }

    // ---- Build attachments array if we actually got a file ----
    const attachments: { filename: string; content: Buffer }[] = [];
    if (file && file.filepath && fs.existsSync(file.filepath)) {
      const fileBuffer = fs.readFileSync(file.filepath);
      attachments.push({
        filename: file.originalFilename || "attachment",
        content: fileBuffer,
      });
      console.log("✅ Attachment added:", file.originalFilename);
    } else {
      console.log("ℹ️ No attachment on this request");
    }

    // ---- SMTP transporter ----
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 465,
      secure: true,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    // ---- Email HTML ----
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
          <p><strong>Brief:</strong><br>${body.brief?.replace(/\n/g, "<br>") || "(none)"}</p>
        `
            : `
          <p><strong>Message:</strong><br>${body.message?.replace(/\n/g, "<br>") || "(none)"}</p>
        `
        }
        ${file ? `<p><strong>Attachment:</strong> ${file.originalFilename}</p>` : ""}
      </div>
    `;

    // ---- Send email ----
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
    return res
      .status(500)
      .json({ success: false, error: err?.message || "Internal server error" });
  }
}
