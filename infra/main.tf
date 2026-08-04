terraform {
  required_version = ">= 1.10"
  required_providers {
    aws     = { source = "hashicorp/aws", version = ">= 5.40" }
    archive = { source = "hashicorp/archive", version = ">= 2.4" }
  }
}

provider "aws" {
  region = var.region
  default_tags {
    tags = {
      Project   = "intechsolutions-net"
      ManagedBy = "terraform"
    }
  }
}

data "aws_caller_identity" "current" {}

# ---------------------------------------------------------------------------
# SES
#
# Sending from an address at your own domain (not Gmail) is what lets the mail
# be DKIM-signed and survive spam filtering. The Gmail SMTP password the
# WordPress site used is retired by this.
# ---------------------------------------------------------------------------

resource "aws_sesv2_email_identity" "domain" {
  email_identity = var.mail_subdomain

  dkim_signing_attributes {
    next_signing_key_length = "RSA_2048_BIT"
  }
}

# The recipient must be verified while the account is in the SES sandbox.
# Harmless to keep afterwards.
resource "aws_sesv2_email_identity" "recipient" {
  email_identity = var.contact_to
}

# ---------------------------------------------------------------------------
# Lambda
# ---------------------------------------------------------------------------

data "archive_file" "fn" {
  type        = "zip"
  source_dir  = "${path.module}/lambda"
  output_path = "${path.module}/.build/contact.zip"
}

data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "fn" {
  name               = "intech-contact-form"
  assume_role_policy = data.aws_iam_policy_document.assume.json
}

resource "aws_iam_role_policy_attachment" "logs" {
  role       = aws_iam_role.fn.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Send only, and only as this identity — a compromised function cannot be used
# to send mail as anything else in the account.
# Both identities, not just the sending domain.
#
# The obvious policy — grant SendEmail on the From identity — is not enough
# while the account is in the SES sandbox. There, the verified recipient is
# itself an identity and the call is authorised against it too, so a
# domain-only grant fails with:
#
#   not authorized to perform `ses:SendEmail' on resource
#   `arn:aws:ses:...:identity/<recipient>'
#
# which reads like the sender is wrong and is not. Local testing does not
# catch this: a developer's own IAM user has broader rights than this role,
# so the form passes end to end locally and 502s once deployed.
data "aws_iam_policy_document" "send" {
  statement {
    actions = ["ses:SendEmail"]
    resources = [
      aws_sesv2_email_identity.domain.arn,
      aws_sesv2_email_identity.recipient.arn,
    ]
  }
}

resource "aws_iam_role_policy" "send" {
  name   = "ses-send"
  role   = aws_iam_role.fn.id
  policy = data.aws_iam_policy_document.send.json
}

resource "aws_lambda_function" "contact" {
  function_name    = "intech-contact-form"
  role             = aws_iam_role.fn.arn
  handler          = "index.handler"
  runtime          = "nodejs22.x"
  filename         = data.archive_file.fn.output_path
  source_code_hash = data.archive_file.fn.output_base64sha256
  timeout          = 10
  memory_size      = 256

  environment {
    variables = {
      CONTACT_TO       = var.contact_to
      CONTACT_FROM     = "Innovative Technology Solutions <noreply@${var.mail_subdomain}>"
      ALLOWED_ORIGINS  = join(",", var.allowed_origins)
      TURNSTILE_SECRET = var.turnstile_secret
      NODE_OPTIONS     = "--enable-source-maps"
    }
  }
}

# Function URL rather than API Gateway: no per-request gateway cost, no REST
# API to configure, and this endpoint does exactly one thing.
resource "aws_lambda_function_url" "contact" {
  function_name      = aws_lambda_function.contact.function_name
  authorization_type = "NONE" # public by design; the function validates everything
}

# Keep logs cheap and bounded — this is a contact form, not an audit trail.
resource "aws_cloudwatch_log_group" "fn" {
  name              = "/aws/lambda/${aws_lambda_function.contact.function_name}"
  retention_in_days = 14
}
