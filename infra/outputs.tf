output "contact_endpoint" {
  value       = aws_lambda_function_url.contact.function_url
  description = "Set as the PUBLIC_CONTACT_ENDPOINT Actions variable."
}

output "dkim_tokens" {
  value       = aws_sesv2_email_identity.domain.dkim_signing_attributes[0].tokens
  description = "Three CNAMEs on the mail subdomain."
}

output "dns_records_to_add" {
  description = "Add these at Network Solutions, where intechsolutions.net DNS lives."
  value       = <<-EOT

    All records are on the ${var.mail_subdomain} subdomain — nothing here
    touches the root domain, so Microsoft 365 mail is unaffected.

    DKIM (3 records, tokens from `terraform output dkim_tokens`):
      CNAME  <token>._domainkey.${var.mail_subdomain}  ->  <token>.dkim.amazonses.com

    SPF for the subdomain only:
      TXT    ${var.mail_subdomain}  ->  "v=spf1 include:amazonses.com -all"

    DMARC for the subdomain only:
      TXT    _dmarc.${var.mail_subdomain}  ->  "v=DMARC1; p=none; rua=mailto:${var.contact_to}"

    Do NOT add an SPF record to the root domain. It already publishes two,
    which is an RFC 7208 violation that makes SPF permerror for the whole
    domain. That is a pre-existing problem with the Microsoft 365 / Proofpoint
    setup and should be fixed separately by merging them into one record.

  EOT
}

output "verification_next_steps" {
  value = <<-EOT

    1. Add the DNS records above at Network Solutions (ns1/ns2.worldnic.com).

    2. Verify the recipient — AWS emails ${var.contact_to} a confirmation link.
       Required while the account is in the SES sandbox. That is a real
       Microsoft 365 mailbox, so someone needs to open it and click through.

    3. Production access is NOT required. The sandbox allows 200 emails/day to
       verified recipients; this form sends to one fixed address a few times a
       day. Reply-To carries the visitor address and needs no verification.
       Request production access only to auto-reply to submitters.

    4. Set the repository variables:
         PUBLIC_CONTACT_ENDPOINT   = <contact_endpoint output>
         PUBLIC_TURNSTILE_SITE_KEY = <from Cloudflare Turnstile>

  EOT
}
