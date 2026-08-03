#!/usr/bin/env node
/* ---------------------------------------------------------------------------
   Runs the contact Lambda locally against REAL SES, so the whole form can be
   tested before anything is deployed.

   It wraps infra/lambda/index.mjs in the same event shape a Lambda Function
   URL sends, which means you are exercising the real handler — the origin
   allow-list, the honeypot, the timing check, the validation, Turnstile and
   the SES call. A mock would prove none of those.

   Usage:
     npm run dev:contact          # this, on :8787
     npm run dev                  # the site, on :4321

   and in .env.local:
     PUBLIC_CONTACT_ENDPOINT=http://localhost:8787

   WHERE THE MAIL GOES
   -------------------
   By default, nowhere: CONTACT_TO is AWS's mailbox simulator, which accepts
   and discards. That is deliberate — the real recipient is the client's own
   inbox, and a morning of testing should not land in it.

   To send to a real address for a final check:
     CONTACT_TO=you@example.com npm run dev:contact

   The account is in the SES SANDBOX, so that address must itself be a
   verified SES identity or the send fails with MessageRejected. Simulator
   addresses are exempt from that rule.

   Credentials come from the ambient AWS profile — your IAM user, not the
   Lambda's role. Passing locally therefore proves the handler and the SES
   identity, but NOT the role policy in main.tf; only `terraform apply` does
   that.
--------------------------------------------------------------------------- */

import { createServer } from 'node:http'

const PORT = Number(process.env.PORT ?? 8787)
const SITE = process.env.SITE_URL ?? 'http://localhost:4321'

/* Discards whatever it receives, needs no verification, and never counts
   against sending reputation. See "Mailbox simulator" in the SES docs. */
const SIMULATOR = 'success@simulator.amazonses.com'

process.env.CONTACT_TO ??= SIMULATOR
process.env.CONTACT_FROM ??=
  'Innovative Technology Solutions <noreply@mail.intechsolutions.net>'
process.env.ALLOWED_ORIGINS ??= [SITE, 'http://127.0.0.1:4321'].join(',')
process.env.AWS_REGION ??= 'us-east-1'

const toSimulator = process.env.CONTACT_TO.endsWith('@simulator.amazonses.com')

const { handler } = await import('../infra/lambda/index.mjs')

createServer(async (req, res) => {
  const chunks = []
  for await (const c of req) chunks.push(c)

  /* Every request from your machine arrives as the same address, so the
     handler's per-IP limiter sees one bucket and a handful of test posts trips
     it. x-test-ip lets a test suite pretend to be different callers, which is
     the only way to exercise the limiter deliberately rather than by accident.
     Dev-only: the deployed Function URL fills sourceIp in itself and never
     reads this header. */
  const event = {
    headers: { origin: req.headers.origin ?? '' },
    requestContext: {
      http: {
        method: req.method,
        sourceIp:
          req.headers['x-test-ip'] ?? req.socket.remoteAddress ?? '127.0.0.1',
      },
    },
    body: Buffer.concat(chunks).toString('utf8'),
  }

  const out = await handler(event)

  /* The handler answers 200 to a tripped honeypot and to a too-fast submit,
     on purpose — telling a bot which check caught it teaches it to pass. That
     makes the console indistinguishable from success, so say so here. */
  console.log(`${req.method} ${req.url} -> ${out.statusCode} ${out.body ?? ''}`)
  if (out.statusCode === 200) {
    console.log(
      `   ${toSimulator ? 'discarded by the simulator' : 'DELIVERED to ' + process.env.CONTACT_TO}` +
        ' — unless a silent bot check fired; check for a warn line above.'
    )
  }

  res.writeHead(out.statusCode, out.headers ?? {})
  res.end(out.body ?? '')
}).listen(PORT, () => {
  console.log(`contact handler on http://localhost:${PORT}`)
  console.log(`  mail to        ${process.env.CONTACT_TO}${toSimulator ? '  (discarded)' : '  ** REAL INBOX **'}`)
  console.log(`  mail from      ${process.env.CONTACT_FROM}`)
  console.log(`  origin allowed ${process.env.ALLOWED_ORIGINS}`)
  console.log(
    `  turnstile      ${process.env.TURNSTILE_SECRET ? 'on' : 'OFF — the widget is not checked'}`
  )
  console.log(`\nset PUBLIC_CONTACT_ENDPOINT=http://localhost:${PORT} in .env.local\n`)
})
