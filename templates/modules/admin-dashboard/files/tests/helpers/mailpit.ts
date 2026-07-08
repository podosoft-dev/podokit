// Helpers for the local Mailpit catcher (docker-compose / CI service). Tests that
// exercise email flows skip when it isn't reachable (see MAILPIT_URL).
const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:8025";

export async function mailpitReachable(): Promise<boolean> {
  try {
    return (await fetch(`${MAILPIT}/readyz`)).ok;
  } catch {
    return false;
  }
}

export async function clearMailpit(): Promise<void> {
  try {
    await fetch(`${MAILPIT}/api/v1/messages`, { method: "DELETE" });
  } catch {
    /* ignore */
  }
}

type MailpitList = { messages: Array<{ ID: string; To: Array<{ Address: string }> }> };
type MailpitMessage = { Text?: string; HTML?: string };

// Poll for the newest message addressed to `to` and return the first link in it.
export async function waitForLink(to: string, timeoutMs = 10000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const list = (await (await fetch(`${MAILPIT}/api/v1/messages`)).json()) as MailpitList;
    const msg = list.messages?.find((m) => m.To?.some((t) => t.Address === to));
    if (msg) {
      const full = (await (await fetch(`${MAILPIT}/api/v1/message/${msg.ID}`)).json()) as MailpitMessage;
      const match = `${full.Text ?? ""} ${full.HTML ?? ""}`.match(/https?:\/\/[^\s"<>]+/);
      if (match) return match[0];
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`no email with a link to ${to} within ${timeoutMs}ms`);
}
