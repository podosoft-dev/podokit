---
"@podosoft/podokit": patch
---

The mailer module depends on `nodemailer ^10.2.1`. Nodemailer 9 has published advisories that 10.0.9 and later fix: remote denial of service through quadratic address and DKIM header parsing, a TLS `servername` reused across transports by the process-wide DNS cache, and malformed envelope recipients from quoted local parts. Nodemailer 10 requires Node.js 20 or Bun and keeps the `@types/nodemailer` type layout, so the generated mailer code is unchanged. Existing projects pick up the new range with `podo update`.
