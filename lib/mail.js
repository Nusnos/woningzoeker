import nodemailer from 'nodemailer';
import { AppError } from './errors.js';

export function mailConfig() {
  const user = process.env.SMTP_USER;
  const host = process.env.SMTP_HOST || (/@(gmail|googlemail)\.com$/i.test(user || '') ? 'smtp.gmail.com' : undefined);
  if (!host || !user || !process.env.SMTP_PASSWORD) throw new AppError('MAIL_CONFIG', 'E-mailmeldingen zijn tijdelijk niet beschikbaar.', 503);
  const port = Number(process.env.SMTP_PORT || 465);
  return { host, port, secure: port === 465, requireTLS: port !== 465,
    auth: { user, pass: process.env.SMTP_PASSWORD },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
    tls: { minVersion: 'TLSv1.2' } };
}

export async function sendMail(message) {
  const transport = nodemailer.createTransport(mailConfig());
  const info = await transport.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, ...message });
  if (!info.accepted?.length || info.rejected?.length) throw new AppError('MAIL_REJECTED', 'De e-mailserver heeft de melding geweigerd.');
  return info.messageId;
}

export async function verifySmtp() {
  return nodemailer.createTransport(mailConfig()).verify();
}
