resource "random_password" "db_master" {
  length           = 32
  special          = true
  override_special = "!#$%&*()-_=+[]{}<>:?"
}

resource "aws_db_instance" "main" {
  identifier = "${var.app_name}-${var.environment}"

  engine         = "postgres"
  engine_version = var.db_engine_version
  instance_class = var.db_instance_class

  db_name  = var.db_name
  username = var.db_username
  password = random_password.db_master.result

  # ── Storage ────────────────────────────────────────────────────────────────
  allocated_storage     = 20
  max_allocated_storage = 100  # autoscaling ceiling
  storage_type          = "gp3"

  # ── Encryption (customer-managed KMS key, not AWS default) ────────────────
  storage_encrypted = true
  kms_key_id        = aws_kms_key.rds.arn

  # ── Network — private only, never reachable from public internet ───────────
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = false  # NEVER change this to true

  # ── Backups — 7-day PITR ──────────────────────────────────────────────────
  backup_retention_period   = var.db_backup_retention_days
  backup_window             = "03:00-04:00"  # UTC — low-traffic window
  maintenance_window        = "Mon:04:00-Mon:05:00"
  delete_automated_backups  = false

  # ── Multi-AZ ──────────────────────────────────────────────────────────────
  # Currently false for cost at early stage.
  # Enable when first paying clients depend on uptime:
  #   multi_az = true
  # Downtime for the change: ~20 minutes during promotion. Plan a maintenance window.
  multi_az = false

  # ── Misc ──────────────────────────────────────────────────────────────────
  auto_minor_version_upgrade  = true
  copy_tags_to_snapshot       = true
  deletion_protection         = true  # prevents accidental destroy via Terraform
  skip_final_snapshot         = false
  final_snapshot_identifier   = "${var.app_name}-${var.environment}-final"

  # Enable Enhanced Monitoring (free at 60s interval)
  monitoring_interval = 60
  monitoring_role_arn = aws_iam_role.rds_monitoring.arn

  # CloudWatch logs: capture slow queries and errors
  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]

  # Performance Insights (free for 7 days retention on t4g)
  performance_insights_enabled          = true
  performance_insights_retention_period = 7
  performance_insights_kms_key_id       = aws_kms_key.rds.arn
}

# IAM role required for Enhanced Monitoring
resource "aws_iam_role" "rds_monitoring" {
  name = "${var.app_name}-rds-monitoring-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "monitoring.rds.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "rds_monitoring" {
  role       = aws_iam_role.rds_monitoring.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"
}

# Parameter group: enable pg_audit extension for future compliance logging
resource "aws_db_parameter_group" "main" {
  name   = "${var.app_name}-pg16-${var.environment}"
  family = "postgres16"

  parameter {
    name  = "log_min_duration_statement"
    value = "1000"  # log queries slower than 1 second
  }

  parameter {
    name  = "log_connections"
    value = "1"
  }

  parameter {
    name  = "log_disconnections"
    value = "1"
  }
}
