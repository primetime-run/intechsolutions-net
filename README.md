# intechsolutions.net

The website for **Innovative Technology Solutions**, a managed IT provider.

ITS looks after the technology small and mid-sized businesses run on — the
servers, the network, the phones, the backups and the cameras — so that the
people who work there can get on with the work rather than worry about the
wiring. Seven service lines:

| Service | What it covers |
|---|---|
| Business Continuity | Staying running through hardware failure and disaster |
| Managed IT Solutions | Proactive management of the whole environment |
| Cloud Services | Critical data, on any device, anywhere |
| Security Services | Viruses, malware and ransomware |
| VOIP | Calls without a PBX, from anywhere |
| Video Surveillance | Watching premises and assets remotely |
| Structured Cabling | Network, coax and AV, installed and tested |

The site's job is narrow: explain those services clearly, and make it easy to
start a conversation. Every service page ends with a call to action that carries
its own topic into the contact form, so an enquiry arrives already labelled.

## How it is built

A static site with one dynamic piece.

```
Astro ──build──> static HTML ──> GitHub Pages

contact form ──POST json──> Lambda Function URL ──> SES ──> the office inbox
```

Static because a brochure site has nothing to compute per visitor: it is fast,
there is no server to patch, no database to back up, and no admin login to
compromise. The contact form is the one thing that genuinely needs a server, so
it is the only thing that has one — a single function that runs when someone
submits, and costs nothing the rest of the time.

## Running it locally

```bash
npm install
npm run dev                    # site on :4321
```

Everything works offline except sending mail. To exercise the real contact form:

```bash
npm run dev:contact            # handler on :8787, against real SES
```

and point the site at it in `.env.local` (gitignored):

```
PUBLIC_CONTACT_ENDPOINT=http://localhost:8787
```

`dev:contact` imports the actual Lambda from `infra/lambda/` and wraps it in the
event shape a Function URL sends — you are testing the deployed code path, not a
mock. **Mail defaults to AWS's mailbox simulator, which accepts and discards**,
so a morning of testing never reaches the office inbox. To do a final real
check, `CONTACT_TO=you@example.com npm run dev:contact`; that address must be a
verified SES identity (see [Email](#email)).

Other commands:

```bash
npm run build                  # static output into dist/
npm run verify-urls            # asserts no published URL has broken
npm run icons                  # regenerates the favicon set
```

## Content

Service pages are Markdown in `src/content/services/`. To add or edit a service,
edit the Markdown — no template changes needed. `order` controls its position on
the homepage; `icon` picks one of the inline SVGs; `summary` is the one-liner
shown on cards and in search results.

**Routes come from the `originalUrl` field, not from the filename:**

```yaml
originalUrl: "/business-continuity/"
```

These addresses have been published for years and are linked from directories,
email signatures and printed material. Generating routes from a declared field
rather than a slug means renaming a file cannot silently break an inbound link.
`npm run verify-urls` asserts every path in `url-inventory.json` still resolves
in `dist/`, and CI runs it before publishing, so that guarantee is enforced
rather than remembered.

### Managed IT Solutions is unpublished

`managed-it-solutions.md` carries `draft: true` — it has no real copy yet. The
URL is reserved so it can be published without changing addresses. To ship it:
write the copy, remove `draft: true`, and add the path to `url-inventory.json`.

## Contact form

Everything is checked server-side; nothing trusts the browser. In order, cheapest
first, so abuse costs the least:

1. **Origin allow-list** — only intechsolutions.net may post
2. **Honeypot** — a hidden field no person sees
3. **Timing** — rejects submissions faster than 3 seconds
4. **Validation** — length caps, email shape, CR/LF stripped to stop header
   injection
5. **CAPTCHA** — currently disabled; see below
6. **Per-IP rate limit** — best effort, in-memory per container

The honeypot and timing checks return `200` on failure deliberately: telling a
bot which check caught it teaches it to pass next time.

The service dropdown pre-selects from `?service=<slug>`. The Lambda maps that
slug through an allow-list rather than echoing it, because the value lands in the
subject line. Reply-To is set to the sender, so replying from the inbox reaches
them directly.

**The CAPTCHA is off.** The code supports Cloudflare Turnstile — leave
`TURNSTILE_SECRET` empty and verification is skipped. Two of the remaining
defences are weaker than they look: the origin allow-list only stops browsers,
since any script can set an `Origin` header, and the rate limit is per warm
Lambda container rather than global. If spam starts arriving, adding Turnstile is
a site key in a repository variable plus `TF_VAR_turnstile_secret` on the Lambda.

## Email

Mail is sent by SES from the **`mail.intechsolutions.net`** subdomain, which is
deliberately separate from the root domain's Microsoft 365 / Proofpoint setup —
nothing here touches the records that office mail depends on.

**SES production access is not required.** The sandbox allows 200 emails a day to
verified recipients, and this form sends to exactly one fixed address at roughly
3/day. Reply-To carries the visitor's address and needs no verification; SES only
validates the Destination.

The sandbox is also a useful safety ceiling: even if every other control failed,
the endpoint could only ever deliver to the one verified recipient, never to
strangers. Request production access only if you later want to auto-reply to
whoever submitted the form — that means sending to an unverified address.

To check SES independently of any code:

```bash
aws sesv2 send-email --region us-east-1 \
  --from-email-address "noreply@mail.intechsolutions.net" \
  --destination 'ToAddresses=success@simulator.amazonses.com' \
  --content '{"Simple":{"Subject":{"Data":"check"},"Body":{"Text":{"Data":"check"}}}}'
```

A returned `MessageId` proves the identity, DKIM and IAM permissions all work.

## Deploy

### 1. Infrastructure

```bash
cd infra
terraform init
terraform apply
terraform output contact_endpoint
terraform output dns_records_to_add
```

`contact_to` has no default and is read from `terraform.tfvars`, which is
gitignored — this repository is public. Note that Terraform state is local and
unencrypted; move it to an S3 backend if more than one person ever runs `apply`.

### 2. Repository variables

Settings → Secrets and variables → Actions → **Variables** (not Secrets — a
Function URL is not sensitive, it validates server-side, and masking it only
makes build logs useless):

| Variable | Source |
|---|---|
| `PUBLIC_CONTACT_ENDPOINT` | `terraform output contact_endpoint` |
| `PUBLIC_TURNSTILE_SITE_KEY` | Cloudflare, only if enabling the CAPTCHA |

Without the first, the form ships a "not configured yet" message. Variables are
read at workflow start, so re-run the workflow after setting them.

### 3. Pages

Settings → Pages → **Source: GitHub Actions**, then set **Custom domain** to
`intechsolutions.net` after the first successful deploy. The committed
`public/CNAME` does not set this on its own with `deploy-pages@v5`.

Pushing to `main` builds and publishes. `verify-urls` runs before publishing and
fails the deploy if a published URL stopped resolving.

### 4. DNS — at Network Solutions

DNS is at `ns1/ns2.worldnic.com`, not Route 53. Two record changes point the
domain at Pages:

| Record | Value |
|---|---|
| `A` @ | `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153` |
| `CNAME` www | `primetime-run.github.io` |

`www` is currently an A record; it must be **deleted** before a CNAME can be
created on the same host. Turn off any web forwarding or domain parking — that
sits above DNS and overrides it silently.

Add the DKIM, SPF and DMARC records from `terraform output dns_records_to_add`.
They are all on the `mail.` subdomain.

**Do not touch:** the `MX` records, the root `TXT` records, or the
`autodiscover` / `lyncdiscover` / `sip` / `msoid` hosts. Those are live office
mail and Microsoft 365 client configuration.

Lower the TTL on the apex and `www` a few hours before cutover — it is 2 hours by
default, which is also how long a rollback would take.

## Cost

| | Monthly |
|---|---|
| GitHub Pages | $0 |
| Lambda (free tier covers this by orders of magnitude) | $0 |
| SES (~$0.10 per 1,000 emails) | ~$0.00 |
| CloudWatch logs (14-day retention) | ~$0.01 |

## Known issues

These are pre-existing and outside this project, but they are real:

- **The root domain publishes two SPF records.** RFC 7208 forbids more than one;
  receivers must treat it as `permerror`, so SPF effectively fails for the whole
  domain — and both records end in `-all`. They need merging into one. Sending
  from the `mail.` subdomain keeps this project clear of it, but office mail is
  affected today.
- One of those SPF records begins with `a:`, which authorises whatever the root
  `A` record points at. After the DNS cutover that means GitHub's IPs. Harmless
  in practice, but wrong, and a reason to fix the SPF at the same time.
- **`enterpriseregistration` and `enterpriseenrollment` point at the old web
  server** instead of Microsoft. They should be `enterpriseregistration.windows.net`
  and `enterpriseenrollment.manage.microsoft.com`, or removed. Do not repoint
  them at the new IPs.

## Notes

- No webfonts, no icon fonts, no third-party scripts, no analytics. Service icons
  are inline SVG. The browser loads nothing from another domain — the only
  outside URLs in the output are ordinary links a visitor has to click — so there
  is no cookie banner to show and nothing to disclose. Verify after a change
  with:

  ```bash
  grep -rhoE 'https?://[a-zA-Z0-9._-]+' dist --include="*.html" --include="*.css" \
    --include="*.js" | sort -u
  ```
- Brand colours are navy `#212f6e` and red `#ed1b24`.
- `npm run icons` generates the whole favicon set from `src/assets/mark.png`. If
  a true vector of the mark ever turns up, drop it in as `public/favicon.svg` and
  the script prefers it automatically — it rasterises more cleanly at 16px than
  any downscale can.
- The hero image is stock. Worth replacing with a photograph of real work.
