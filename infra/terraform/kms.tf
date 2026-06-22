# Customer-managed KMS keys — separate keys for RDS and S3 so you can
# revoke them independently and tell clients "we control the key, not AWS."

resource "aws_kms_key" "rds" {
  description             = "EstateCFO RDS encryption key"
  deletion_window_in_days = 14
  enable_key_rotation     = true

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "Enable IAM User Permissions"
        Effect    = "Allow"
        Principal = { AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root" }
        Action    = "kms:*"
        Resource  = "*"
      },
      {
        Sid    = "Allow RDS to use the key"
        Effect = "Allow"
        Principal = {
          Service = "rds.amazonaws.com"
        }
        Action = [
          "kms:Encrypt",
          "kms:Decrypt",
          "kms:ReEncrypt*",
          "kms:GenerateDataKey*",
          "kms:DescribeKey",
          "kms:CreateGrant",
        ]
        Resource = "*"
      },
      {
        Sid    = "Allow app role to describe key (for audit)"
        Effect = "Allow"
        Principal = {
          AWS = aws_iam_role.app.arn
        }
        Action   = ["kms:DescribeKey"]
        Resource = "*"
      },
    ]
  })
}

resource "aws_kms_alias" "rds" {
  name          = "alias/${var.app_name}-rds-${var.environment}"
  target_key_id = aws_kms_key.rds.key_id
}

resource "aws_kms_key" "s3" {
  description             = "EstateCFO S3 uploads encryption key"
  deletion_window_in_days = 14
  enable_key_rotation     = true

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "Enable IAM User Permissions"
        Effect    = "Allow"
        Principal = { AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root" }
        Action    = "kms:*"
        Resource  = "*"
      },
      {
        Sid    = "Allow S3 to use key for SSE-KMS"
        Effect = "Allow"
        Principal = {
          Service = "s3.amazonaws.com"
        }
        Action = [
          "kms:GenerateDataKey",
          "kms:Decrypt",
        ]
        Resource = "*"
      },
      {
        Sid    = "Allow app role to encrypt/decrypt S3 objects"
        Effect = "Allow"
        Principal = {
          AWS = aws_iam_role.app.arn
        }
        Action = [
          "kms:GenerateDataKey",
          "kms:Decrypt",
        ]
        Resource = "*"
      },
    ]
  })
}

resource "aws_kms_alias" "s3" {
  name          = "alias/${var.app_name}-s3-${var.environment}"
  target_key_id = aws_kms_key.s3.key_id
}

data "aws_caller_identity" "current" {}
