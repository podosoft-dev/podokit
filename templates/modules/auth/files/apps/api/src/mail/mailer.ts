import nodemailer, { type Transporter } from "nodemailer";
import { pool } from "../auth/db";
import { createConfigStore, type SmtpConfig } from "@podosoft/podokit-auth";

// SMTP is admin-configurable in the DB (auth_config), falling back to SMTP_* env,
// and applied live: the transport is rebuilt when the config changes (short TTL),
// so no restart is needed. With neither DB nor env config, fall back to a transport
// that just logs the message so nothing crashes for lack of mail config.
const store = createConfigStore(pool);
const TTL_MS = 3_000;

function buildTransport(smtp: SmtpConfig | null): Transporter {
  if (!smtp) return nodemailer.createTransport({ jsonTransport: true });
  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass ?? "" } : undefined,
  });
}

let transport = buildTransport(null);
let transportFrom = process.env.MAIL_FROM ?? "PodoKit <no-reply@example.com>";
let hasSmtp = false;
let checkedAt = 0;
let signature = "";

async function getTransport(): Promise<Transporter> {
  if (checkedAt !== 0 && Date.now() - checkedAt < TTL_MS) return transport;
  checkedAt = Date.now();
  try {
    const smtp = await store.smtpConfig();
    const next = JSON.stringify(smtp ?? null);
    if (next !== signature) {
      transport = buildTransport(smtp);
      transportFrom = smtp?.from ?? process.env.MAIL_FROM ?? "PodoKit <no-reply@example.com>";
      hasSmtp = !!smtp;
      signature = next;
    }
  } catch {
    /* keep the last-good transport */
  }
  return transport;
}

export type Mail = { to: string; subject: string; text: string; html?: string };

export async function sendMail(mail: Mail): Promise<void> {
  const t = await getTransport();
  const info = await t.sendMail({ from: transportFrom, ...mail });
  if (!hasSmtp) {
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
