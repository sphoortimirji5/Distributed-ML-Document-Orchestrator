variable "aws_region" {
  description = "AWS region to deploy resources"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment name (e.g., production, staging)"
  type        = string
  default     = "production"
}

variable "project_name" {
  description = "Name of the project"
  type        = string
  default     = "document-orchestrator"
}

variable "file_size_threshold_mb" {
  description = "File size threshold for sync vs async processing (MB)"
  type        = number
  default     = 10
}

variable "kinesis_shard_count" {
  description = "Number of Kinesis shards"
  type        = number
  default     = 1
}

variable "reaper_stuck_threshold_mins" {
  description = "Minutes before a processing document is considered stuck"
  type        = number
  default     = 30
}

variable "reaper_cron_expression" {
  description = "Cron expression for reaper scan interval"
  type        = string
  default     = "0 */5 * * * *"
}
