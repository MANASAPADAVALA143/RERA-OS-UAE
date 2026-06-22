# ── App IAM role — attached to EC2 instance profile or ECS task role ─────────
# Never create long-lived static access keys for the app to use.
# Instead, attach this role to wherever the compute runs.

resource "aws_iam_role" "app" {
  name = "${var.app_name}-app-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowEC2"
        Effect = "Allow"
        Principal = { Service = "ec2.amazonaws.com" }
        Action = "sts:AssumeRole"
      },
      {
        Sid    = "AllowECS"
        Effect = "Allow"
        Principal = { Service = "ecs-tasks.amazonaws.com" }
        Action = "sts:AssumeRole"
      },
    ]
  })
}

# EC2 instance profile wrapper (required if running on EC2)
resource "aws_iam_instance_profile" "app" {
  name = "${var.app_name}-app-${var.environment}"
  role = aws_iam_role.app.name
}

# ── Policy 1: Bedrock — Nova Lite ONLY ───────────────────────────────────────
# Scoped to the single model ARN in use. Not broad bedrock:* access.
resource "aws_iam_role_policy" "bedrock" {
  name = "bedrock-nova-lite-only"
  role = aws_iam_role.app.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "BedrockInvokeNovaLite"
        Effect = "Allow"
        Action = "bedrock:InvokeModel"
        Resource = [
          # Foundation model ARN
          "arn:aws:bedrock:${var.aws_region}::foundation-model/amazon.nova-lite-v1:0",
          # Cross-region inference profile (the us.* prefix the app uses)
          "arn:aws:bedrock:${var.aws_region}:${data.aws_caller_identity.current.account_id}:inference-profile/us.amazon.nova-lite-v1:0",
        ]
      },
    ]
  })
}

# ── Policy 2: S3 — uploads bucket only, no ListAllMyBuckets ──────────────────
resource "aws_iam_role_policy" "s3" {
  name = "s3-uploads-bucket-only"
  role = aws_iam_role.app.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "S3BucketList"
        Effect = "Allow"
        Action = ["s3:ListBucket", "s3:GetBucketLocation"]
        Resource = aws_s3_bucket.uploads.arn
      },
      {
        Sid    = "S3ObjectAccess"
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:GetObject",
          "s3:DeleteObject",
          "s3:GetObjectVersion",
          "s3:DeleteObjectVersion",
        ]
        Resource = "${aws_s3_bucket.uploads.arn}/*"
      },
    ]
  })
}

# ── Policy 3: KMS — only the S3 key (RDS KMS is handled by RDS service role) ─
resource "aws_iam_role_policy" "kms" {
  name = "kms-s3-key-only"
  role = aws_iam_role.app.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "S3KMSAccess"
        Effect = "Allow"
        Action = [
          "kms:GenerateDataKey",
          "kms:Decrypt",
          "kms:DescribeKey",
        ]
        Resource = aws_kms_key.s3.arn
      },
    ]
  })
}

# ── Policy 4: Secrets Manager — read RDS app credentials only ────────────────
resource "aws_iam_role_policy" "secrets" {
  name = "secrets-rds-app-only"
  role = aws_iam_role.app.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ReadRDSAppSecret"
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue",
          "secretsmanager:DescribeSecret",
        ]
        Resource = aws_secretsmanager_secret.rds_app.arn
      },
      {
        Sid    = "DecryptSecret"
        Effect = "Allow"
        Action = [
          "kms:Decrypt",
          "kms:DescribeKey",
        ]
        Resource = aws_kms_key.rds.arn
      },
    ]
  })
}

# ── Policy 5: CloudWatch Logs — write app logs ────────────────────────────────
resource "aws_iam_role_policy" "cloudwatch_logs" {
  name = "cloudwatch-logs-write"
  role = aws_iam_role.app.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "CloudWatchLogs"
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "logs:DescribeLogStreams",
        ]
        Resource = "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/estatecfo/*"
      },
    ]
  })
}
