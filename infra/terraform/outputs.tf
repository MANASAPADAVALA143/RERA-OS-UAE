output "rds_endpoint" {
  description = "RDS PostgreSQL hostname — set as RDS_SECRET_ARN in Secrets Manager instead of hardcoding"
  value       = aws_db_instance.main.address
  sensitive   = true
}

output "rds_port" {
  value = aws_db_instance.main.port
}

output "rds_secret_arn" {
  description = "ARN of the Secrets Manager secret holding RDS app credentials. Set RDS_SECRET_ARN env var to this."
  value       = aws_secretsmanager_secret.rds_app.arn
}

output "s3_bucket_name" {
  description = "S3 uploads bucket name. Set S3_BUCKET env var to this."
  value       = aws_s3_bucket.uploads.id
}

output "kms_rds_key_arn" {
  description = "Customer-managed KMS key ARN for RDS encryption"
  value       = aws_kms_key.rds.arn
}

output "kms_s3_key_arn" {
  description = "Customer-managed KMS key ARN for S3 encryption"
  value       = aws_kms_key.s3.arn
}

output "app_iam_role_arn" {
  description = "IAM role ARN to attach to your EC2 instance profile or ECS task role"
  value       = aws_iam_role.app.arn
}

output "app_instance_profile_name" {
  description = "EC2 instance profile name (if running on EC2)"
  value       = aws_iam_instance_profile.app.name
}

output "cloudtrail_name" {
  value = aws_cloudtrail.main.name
}

output "env_vars_to_set" {
  description = "Copy-paste reminder of env vars the backend needs"
  value = <<-EOT
    # Set these in your compute environment (EC2 UserData, ECS task def, or .env.prod — never committed):
    RDS_SECRET_ARN=${aws_secretsmanager_secret.rds_app.arn}
    S3_BUCKET=${aws_s3_bucket.uploads.id}
    AWS_REGION=${var.aws_region}
    AUTH_MODE=supabase
    SUPABASE_URL=<your-supabase-url>
    SUPABASE_JWT_SECRET=<your-supabase-jwt-secret>
    # Do NOT set AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY on production compute —
    # the IAM role attached to the instance/task provides credentials automatically.
  EOT
}
