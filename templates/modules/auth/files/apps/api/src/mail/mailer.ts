import nodemailer, { type Transporter } from "nodemailer";

// One transport for the whole app. Point SMTP_* at your provider in production;
// in local dev it targets Mailpit (docker-compose), which captures every message
// at http://localhost:8025. With no SMTP_HOST set, fall back to a transport that
// just logs the message so nothing crashes for lack of mail config.
const from = process.env.MAIL_FROM ?? "PodoKit <no-reply@example.com>";

function createTransport(): Transporter {
  if (!process.env.SMTP_HOST) {
    return nodemailer.createTransport({ jsonTransport: true });
  }
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 1025),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? "" } : undefined,
  });
}

const transport = createTransport();

export type Mail = { to: string; subject: string; text: string; html?: string };

export async function sendMail(mail: Mail): Promise<void> {
  const info = await transport.sendMail({ from, ...mail });
  if (!process.env.SMTP_HOST) {
    // JSON transport: surface the message so the link is grabbable from logs.
    console.log(`[mailer] no SMTP configured; message not delivered:\n${info.message as string}`);
  }
}

// Minimal HTML wrapper for a titled call-to-action email.
export function actionEmail(title: string, body: string, url: string, cta: string): string {
  return `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto">
  <h1 style="font-size:20px">${title}</h1>
  <p>${body}</p>
  <p><a href="${url}" style="display:inline-block;padding:10px 16px;background:#111;color:#fff;border-radius:8px;text-decoration:none">${cta}</a></p>
  <p style="color:#666;font-size:13px">Or paste this link into your browser:<br>${url}</p>
</div>`;
}
