variable "region" {
  description = "Region for Lambda and SES. Must be one where SES is available."
  type        = string
  default     = "us-east-1"
}

variable "domain" {
  description = "Root domain — used for the site URL and DMARC guidance only."
  type        = string
  default     = "intechsolutions.net"
}

variable "mail_subdomain" {
  description = <<-EOT
    Subdomain SES sends from, e.g. mail.intechsolutions.net.

    Deliberately NOT the root domain. intechsolutions.net carries live
    Microsoft 365 mail behind Proofpoint, and already publishes two conflicting
    SPF records (an RFC violation that makes SPF permerror). Sending
    transactional mail from an isolated subdomain means SES gets its own clean
    SPF and DKIM, and nothing we do here can affect business email.
  EOT
  type        = string
  default     = "mail.intechsolutions.net"
}

variable "contact_to" {
  description = <<-EOT
    Where submissions are delivered. Must be a real mailbox — SES emails it a
    verification link that has to be clicked while the account is in sandbox.

    Deliberately has no default: this repository is public, and a plaintext
    business address in a committed file gets harvested by spam scrapers. Set
    it in infra/terraform.tfvars (gitignored) or via TF_VAR_contact_to.
  EOT
  type        = string
}

variable "allowed_origins" {
  description = <<-EOT
    Origins permitted to POST the form. Anything else is rejected with 403,
    which stops the endpoint being used from other sites.
  EOT
  type        = list(string)
  default     = ["https://intechsolutions.net", "https://www.intechsolutions.net"]
}

variable "turnstile_secret" {
  description = <<-EOT
    Cloudflare Turnstile secret key. Pass via TF_VAR_turnstile_secret, never
    commit it. Leave empty to run without Turnstile — the honeypot, timing
    check, origin allow-list and rate limit still apply.
  EOT
  type        = string
  default     = ""
  sensitive   = true
}
