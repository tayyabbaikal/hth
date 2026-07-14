// Email sending via Resend. When RESEND_API_KEY is unset (local dev), emails
// are logged to stdout instead of sent — so nothing blocks on email delivery.
import { Resend } from "resend";
import { env } from "./env";

const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

export async function sendEmail(to: string, subject: string, html: string) {
  if (!resend) {
    // eslint-disable-next-line no-console
    console.log(`[email:dev] to=${to} subject="${subject}"\n${html}\n`);
    return;
  }
  await resend.emails.send({ from: env.EMAIL_FROM, to, subject, html });
}

export function verifyEmailHtml(link: string) {
  return `<p>Confirm your email to activate your account:</p>
    <p><a href="${link}">Verify email</a></p>
    <p>This link expires in 24 hours.</p>`;
}

export function resetPasswordHtml(link: string) {
  return `<p>Reset your password:</p>
    <p><a href="${link}">Reset password</a></p>
    <p>If you didn't request this, ignore this email. Link expires in 1 hour.</p>`;
}
