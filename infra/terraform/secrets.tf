# RDS master credentials stored in Secrets Manager.
# The backend reads this at startup — credentials never touch .env files
# committed to source control.

resource "aws_secretsmanager_secret" "rds" {
  name                    = "${var.app_name}/${var.environment}/rds"
  description             = "EstateCFO RDS master credentials"
  recovery_window_in_days = 7

  # Encrypt the secret with the same KMS key used for RDS
  kms_key_id = aws_kms_key.rds.arn
}

resource "aws_secretsmanager_secret_version" "rds" {
  secret_id = aws_secretsmanager_secret.rds.id

  secret_string = jsonencode({
    username = var.db_username
    password = random_password.db_master.result
    host     = aws_db_instance.main.address
    port     = aws_db_instance.main.port
    dbname   = var.db_name
    engine   = "postgres"
  })
}

# App-role secret (least-privilege DB user created post-provisioning).
# After running `scripts/migrate_to_rds.sh`, create the app role in psql:
#   CREATE ROLE estatecfo_app WITH LOGIN;
#   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO estatecfo_app;
#   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO estatecfo_app;
# Then update this secret with the app user's password.
resource "aws_secretsmanager_secret" "rds_app" {
  name                    = "${var.app_name}/${var.environment}/rds-app"
  description             = "EstateCFO RDS app-role credentials (least-privilege, used by FastAPI)"
  recovery_window_in_days = 7
  kms_key_id              = aws_kms_key.rds.arn
}

# Placeholder — populate this secret after creating the app DB role:
#   aws secretsmanager put-secret-value \
#     --secret-id estatecfo/prod/rds-app \
#     --secret-string '{"username":"estatecfo_app","password":"...","host":"...","port":5432,"dbname":"estatecfo"}'
resource "aws_secretsmanager_secret_version" "rds_app_placeholder" {
  secret_id = aws_secretsmanager_secret.rds_app.id
  secret_string = jsonencode({
    username = "estatecfo_app"
    password = "REPLACE_AFTER_CREATING_APP_ROLE"
    host     = aws_db_instance.main.address
    port     = aws_db_instance.main.port
    dbname   = var.db_name
  })
}
