# intechsolutions.net

Static site on GitHub Pages, with the contact form handled by a Lambda Function
URL and Amazon SES. Replaces a WordPress install running the Parallax-One theme,
Contact Form 7, reCAPTCHA and Gmail SMTP.

## Develop

```bash
npm install
npm run dev
npm run build && npm run verify-urls
```

## Content

Service pages live in `src/content/services/` as Markdown. Each carries an
`originalUrl`, and **routes are generated from that field** rather than from
slugs — that is what keeps the WordPress URLs alive:

```yaml
originalUrl: "/business-continuity/"
```

`npm run verify-urls` asserts every path in `url-inventory.json` still resolves
in `dist/`. CI runs it before publishing, so a refactor cannot silently break
inbound links.

### Managed IT Solutions is held back

`managed-it-solutions.md` is `draft: true`. On WordPress that page still held the
default Sample Page boilerplate — *"I'm a bike messenger by day, aspiring actor
by night…"* — so there was nothing to migrate. The URL is reserved but the page
is not published. Write real copy, remove `draft: true`, and add the path back
to `url-inventory.json`.

## Contact form

```
browser ──POST json──> Lambda Function URL ──> SES ──> <the address in terraform.tfvars>
```

Everything is validated server-side; nothing trusts the browser. In order:

1. **Origin allow-list** — only intechsolutions.net may post
2. **Honeypot** — a hidden field no person sees
3. **Timing** — rejects submissions faster than 3 seconds
4. **Validation** — length caps, email shape, CR/LF stripped to prevent header
   injection
5. **Cloudflare Turnstile** — last, because it costs a network round trip
6. **Per-IP rate limit** — best effort; see the note in `infra/lambda/index.mjs`

Failures from the honeypot and timing checks return `200` deliberately, so a bot
learns nothing about why it was dropped.

The service dropdown is pre-selected from `?service=<slug>`, which every service
page's CTA links to. The Lambda maps that slug through an allow-list rather than
echoing it, because it lands in the subject line.

## Deploy

### 1. Infrastructure

```bash
cd infra
terraform init
terraform apply          # add -var 'turnstile_secret=…' or use TF_VAR_turnstile_secret
terraform output dns_records_to_add
```

### 2. DNS — at Network Solutions

DNS for this domain is at `ns1/ns2.worldnic.com`, not Bluehost or Route 53.

Add the DKIM, SPF and DMARC records from `terraform output`. They are all on the
**`mail.intechsolutions.net`** subdomain.

> **Do not add SPF to the root domain.** `intechsolutions.net` already publishes
> *two* SPF records, which RFC 7208 forbids — receivers must treat that as
> `permerror`, so SPF effectively fails for the whole domain, and both end in
> `-all`. That is a pre-existing problem with the Microsoft 365 / Proofpoint
> setup and needs fixing separately by merging them into one record. Sending
> from a subdomain keeps this project clear of it entirely.

### 3. SES

- AWS emails **the configured recipient** a verification link. It must be
  clicked, or sending fails while the account is in the sandbox.
- Request **production access** in the SES console. Until granted, SES delivers
  only to verified addresses.

### 4. Turnstile

Create a widget at Cloudflare for `intechsolutions.net`. The **site key** is
public and goes in a repository variable; the **secret key** goes to Terraform
via `TF_VAR_turnstile_secret` and is never committed.

Without a site key the form still works — the honeypot, timing check, origin
allow-list and rate limit all still apply — it just loses the CAPTCHA layer.

### 5. Repository variables

Settings → Secrets and variables → Actions → **Variables** (not secrets; neither
value is sensitive):

| Variable | Source |
|---|---|
| `PUBLIC_CONTACT_ENDPOINT` | `terraform output contact_endpoint` |
| `PUBLIC_TURNSTILE_SITE_KEY` | Cloudflare Turnstile |

### 6. Pages

Settings → Pages → **Source: GitHub Actions**. After the first successful
deploy, set **Custom domain** to `intechsolutions.net`.

The committed `public/CNAME` does *not* set the domain on its own with
`deploy-pages@v5` — it has to be entered in Settings.

## Cost

| | Monthly |
|---|---|
| GitHub Pages | $0 |
| Lambda (free tier covers this by orders of magnitude) | $0 |
| SES (~$0.10 per 1,000 emails) | ~$0.00 |
| CloudWatch logs (14-day retention) | ~$0.01 |

## Notes

- No webfonts. The old theme loaded Cabin and Open Sans from Google — ~90 KB and
  a third-party connection to render text the system stack renders fine.
- Service icons are inline SVG rather than Font Awesome, which cost a ~75 KB
  webfont to draw seven glyphs.
- The hero image is Parallax-One's own stock photo (and it is mirrored). It sits
  under a heavy navy wash so it reads as texture. Worth replacing with a real
  photo of actual work.
- Logo, palette and icons are derived from the original ITC artwork recovered
  from the WordPress media library: navy `#212f6e`, red `#ed1b24`.
