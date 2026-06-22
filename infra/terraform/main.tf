terraform {
  required_version = ">= 1.7"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.50"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Store state in S3 once the bucket exists — bootstrap with local state first,
  # then run `terraform init -migrate-state` after the bucket is created.
  # backend "s3" {
  #   bucket         = "estatecfo-terraform-state"
  #   key            = "prod/terraform.tfstate"
  #   region         = "us-east-1"
  #   encrypt        = true
  #   dynamodb_table = "estatecfo-terraform-lock"
  # }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "EstateCFO"
      Environment = "production"
      ManagedBy   = "terraform"
    }
  }
}
