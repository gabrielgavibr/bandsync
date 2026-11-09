import type { Env } from "../env";
import { log } from "./logger";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Mailer {
  readonly configured: boolean;
  send(msg: MailMessage): Promise<void>;
}

/**
 * E-mail delivery is an external dependency that is not configured by default.
 * Without a provider, messages are logged so developers can copy links from the console.
 */
export function createMailer(env: Env): Mailer {
  if (env.MAIL_PROVIDER === "resend" && env.MAIL_API_KEY && env.MAIL_FROM) {
    const from = env.MAIL_FROM;
    const apiKey = env.MAIL_API_KEY;
    return {
      configured: true,
      async send(msg) {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
          body: JSON.stringify({
            from,
            to: msg.to,
            subject: msg.subject,
            text: msg.text,
            html: msg.html,
          }),
        });
        if (!res.ok) {
          log("error", "mail.send_failed", { status: res.status });
          throw new Error(`mail provider responded ${res.status}`);
        }
      },
    };
  }
  return {
    configured: false,
    async send(msg) {
      log("info", "mail.console", { to: msg.to, subject: msg.subject, text: msg.text });
    },
  };
}

type Locale = "pt-BR" | "en";

const templates = {
  resetPassword: {
    "pt-BR": (url: string) => ({
      subject: "BandSync — redefinição de senha",
      text: `Recebemos um pedido para redefinir sua senha no BandSync.\n\nAbra o link para escolher uma nova senha (válido por 1 hora):\n${url}\n\nSe você não pediu isso, ignore este e-mail.`,
    }),
    en: (url: string) => ({
      subject: "BandSync — password reset",
      text: `We received a request to reset your BandSync password.\n\nOpen the link to choose a new password (valid for 1 hour):\n${url}\n\nIf you did not ask for this, ignore this e-mail.`,
    }),
  },
  invite: {
    "pt-BR": (band: string, url: string) => ({
      subject: `Convite para entrar em ${band} no BandSync`,
      text: `Você foi convidado(a) para participar da banda ${band} no BandSync.\n\nAceite o convite em:\n${url}`,
    }),
    en: (band: string, url: string) => ({
      subject: `Invitation to join ${band} on BandSync`,
      text: `You have been invited to join the band ${band} on BandSync.\n\nAccept the invitation at:\n${url}`,
    }),
  },
};

export function pickLocale(value: string | null | undefined): Locale {
  return value?.toLowerCase().startsWith("pt") ? "pt-BR" : "en";
}

export function resetPasswordMail(
  locale: string | null | undefined,
  to: string,
  url: string,
): MailMessage {
  return { to, ...templates.resetPassword[pickLocale(locale)](url) };
}

export function inviteMail(
  locale: string | null | undefined,
  to: string,
  band: string,
  url: string,
): MailMessage {
  return { to, ...templates.invite[pickLocale(locale)](band, url) };
}
