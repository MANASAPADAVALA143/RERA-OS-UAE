variable "aws_region" {
  description = "AWS region for all resources"
  type        = string
  default     = "us-east-1"
}

variable "app_name" {
  description = "Short lowercase identifier used in resource names"
  type        = string
  default     = "estatecfo"
}

variable "environment" {
  description = "Deployment environment"
  type        = string
  default     = "prod"
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.0.0.0/16"
}

# RDS
variable "db_instance_class" {
  description = "RDS instance class. db.t4g.micro suits a single CA-firm workload. Upgrade to db.t3.small/medium once tenant count grows."
  type        = string
  default     = "db.t4g.micro"
}

variable "db_name" {
  description = "Postgres database name"
  type        = string
  default     = "estatecfo"
}

variable "db_username" {
  description = "Master username for RDS. Password is auto-generated and stored in Secrets Manager."
  type        = string
  default     = "estatecfo_master"
}

variable "db_backup_retention_days" {
  description = "Automated backup retention window in days (minimum 7 for point-in-time recovery)"
  type        = number
  default     = 7
}

variable "db_engine_version" {
  description = "PostgreSQL engine version"
  type        = string
  default     = "16.3"
}

# S3
variable "s3_bucket_name" {
  description = "Name for the EstateCFO file uploads bucket. Must be globally unique."
  type        = string
  # Override in terraform.tfvars: s3_bucket_name = "estatecfo-uploads-yourorgname"
  default     = ""
}

# Compute — update once you choose EC2 vs ECS
variable "app_compute_type" {
  description = "Where the FastAPI backend runs: 'ec2' or 'ecs'. Affects IAM instance profile wiring."
  type        = string
  default     = "ec2"
}
