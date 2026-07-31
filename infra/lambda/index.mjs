/**
 * Contact form handler — Lambda Function URL + SES.
 *
 * Replaces Contact Form 7 + reCAPTCHA + Gmail SMTP. Every check runs
 * server-side; nothing here trusts the browser.
 *
 * Defence in depth, cheapest checks first so abuse costs us the least:
 *   1. Origin allow-list   — blocks casual cross-site posting
 *   2. Honeypot            — free, catches naive bots
 *   3. Submit timing       — a human cannot fill this in under 3 seconds
 *   4. Payload validation  — length caps, email shape, header-injection guard
 *   5. Turnstile           — a network call, so it runs last
 *   6. Per-IP rate limit   — in-memory, best effort
 */
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2'

const ses = new SESv2Client({})

const TO = process.env.CONTACT_TO
const FROM = process.env.CONTACT_FROM
const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET ?? ''
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

const MAX = { firstName: 80, lastName: 80, email: 254, message: 5000 }
const MIN_FILL_MS = 3000

// Allow-list rather than echoing whatever the form posted — the service name
// goes into the subject line, so it must never carry arbitrary input.
const SERVICES = {
  'business-continuity': 'Business Continuity',
  'managed-it-solutions': 'Managed IT Solutions',
  'cloud-services': 'Cloud Services',
  'security-services': 'Security Services',
  voip: 'VOIP',
  'video-surveillance': 'Video Surveillance',
  'structured-cabling': 'Structured Cabling',
}

/**
 * Best-effort per-IP limiter. Lambda containers are per-instance and
 * short-lived, so this throttles a single abuser hammering one warm container
 * rather than providing a real global limit. Turnstile is the actual defence;
 * this just blunts a burst. A global limit would need DynamoDB, which is not
 * worth it for a contact form on a brochure site.
 */
const hits = new Map()
const WINDOW_MS = 60_000
const MAX_PER_WINDOW = 5

function rateLimited(ip) {
  const now = Date.now()
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS)
  recent.push(now)
  hits.set(ip, recent)
  if (hits.size > 1000) hits.clear() // crude cap; container is ephemeral anyway
  return recent.length > MAX_PER_WINDOW
}

const reply = (status, body, origin) => ({
  statusCode: status,
  headers: {
    'content-type': 'application/json',
    // Echo only an allow-listed origin; never reflect arbitrary input.
    ...(origin ? { 'access-control-allow-origin': origin } : {}),
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'cache-control': 'no-store',
  },
  body: JSON.stringify(body),
})

/** Strip CR/LF so user input can never inject extra email headers. */
const clean = (v, max) =>
  String(v ?? '')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, max)

const EMAIL_RE = /^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$/

async function verifyTurnstile(token, ip) {
  if (!TURNSTILE_SECRET) return true // not configured — other checks still apply
  if (!token) return false
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: TURNSTILE_SECRET, response: token, remoteip: ip ?? '' }),
      signal: AbortSignal.timeout(5000),
    })
    const data = await res.json()
    return data.success === true
  } catch {
    return false // fail closed
  }
}

export const handler = async (event) => {
  const headers = event.headers ?? {}
  const origin = headers.origin ?? headers.Origin ?? ''
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : null
  const method = event.requestContext?.http?.method ?? 'POST'
  const ip = event.requestContext?.http?.sourceIp ?? 'unknown'

  if (method === 'OPTIONS') return reply(204, {}, allowed)
  if (method !== 'POST') return reply(405, { error: 'Method not allowed' }, allowed)

  // 1. Origin allow-list.
  if (ALLOWED_ORIGINS.length && !allowed) {
    console.warn('rejected origin', origin)
    return reply(403, { error: 'Forbidden' }, null)
  }

  // 6. Rate limit (cheap, so checked early despite the numbering).
  if (rateLimited(ip)) {
    return reply(429, { error: 'Too many messages. Please wait a minute and try again.' }, allowed)
  }

  let body
  try {
    body = JSON.parse(event.body ?? '{}')
  } catch {
    return reply(400, { error: 'Malformed request.' }, allowed)
  }

  // 2. Honeypot — a real person never sees this field.
  if (String(body.website ?? '').trim() !== '') {
    console.warn('honeypot tripped', ip)
    return reply(200, { ok: true }, allowed) // lie: do not teach the bot
  }

  // 3. Timing — the page stamps renderedAt; humans take longer than 3s.
  const renderedAt = Number(body.renderedAt)
  if (Number.isFinite(renderedAt) && Date.now() - renderedAt < MIN_FILL_MS) {
    console.warn('submitted too fast', ip)
    return reply(200, { ok: true }, allowed)
  }

  // 4. Validate.
  const firstName = clean(body.firstName, MAX.firstName)
  const lastName = clean(body.lastName, MAX.lastName)
  const email = clean(body.email, MAX.email)
  const message = String(body.message ?? '').trim().slice(0, MAX.message)

  if (!firstName || !lastName) return reply(400, { error: 'Please enter your name.' }, allowed)
  if (!EMAIL_RE.test(email)) return reply(400, { error: 'Please enter a valid email address.' }, allowed)

  // 5. Turnstile — last, because it costs a network round trip.
  if (!(await verifyTurnstile(body.turnstileToken ?? body['cf-turnstile-response'], ip))) {
    return reply(400, { error: 'Could not verify you are human. Please try again.' }, allowed)
  }

  const service = SERVICES[String(body.service ?? '')] ?? null

  const text = [
    `From: ${firstName} ${lastName} <${email}>`,
    `Enquiry about: ${service ?? 'General enquiry'}`,
    ``,
    `Message Body:`,
    message || '(no message)',
    ``,
    `--`,
    `Sent from the contact form on Innovative Technology Solutions`,
    `https://intechsolutions.net  ·  ${ip}`,
  ].join('\n')

  // Surface the service in the subject so it is triageable from the inbox list.
  const subject = service
    ? `Contact form: ${service}`
    : 'Innovative Technology Solutions Contact Form Submission'

  try {
    await ses.send(
      new SendEmailCommand({
        FromEmailAddress: FROM,
        Destination: { ToAddresses: [TO] },
        // Reply-To the sender so hitting reply in Gmail reaches them, matching
        // what Contact Form 7 did.
        ReplyToAddresses: [email],
        Content: {
          Simple: {
            Subject: { Data: subject },
            Body: { Text: { Data: text } },
          },
        },
      })
    )
  } catch (err) {
    console.error('SES send failed', err)
    return reply(502, { error: 'Could not send your message. Please try again shortly.' }, allowed)
  }

  return reply(200, { ok: true }, allowed)
}
