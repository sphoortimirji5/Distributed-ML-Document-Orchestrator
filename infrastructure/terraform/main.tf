provider "aws" {
  region = var.aws_region
}

locals {
  full_project_name = "${var.project_name}-${var.environment}"
}

# ========================================
# Networking (VPC)
# ========================================
resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name = "${local.full_project_name}-vpc"
  }
}

resource "aws_subnet" "public_1" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.1.0/24"
  availability_zone = "${var.aws_region}a"
  map_public_ip_on_launch = true

  tags = {
    Name = "${local.full_project_name}-public-1"
  }
}

resource "aws_subnet" "public_2" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.2.0/24"
  availability_zone = "${var.aws_region}b"
  map_public_ip_on_launch = true

  tags = {
    Name = "${local.full_project_name}-public-2"
  }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name = "${local.full_project_name}-igw"
  }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = {
    Name = "${local.full_project_name}-public-rt"
  }
}

resource "aws_route_table_association" "public_1" {
  subnet_id      = aws_subnet.public_1.id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table_association" "public_2" {
  subnet_id      = aws_subnet.public_2.id
  route_table_id = aws_route_table.public.id
}

# ========================================
# S3 Buckets
# ========================================
resource "aws_s3_bucket" "pdfs" {
  bucket = "${local.full_project_name}-pdfs"
}

resource "aws_s3_bucket_server_side_encryption_configuration" "pdfs" {
  bucket = aws_s3_bucket.pdfs.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "pdfs" {
  bucket = aws_s3_bucket.pdfs.id
  rule {
    id     = "DeleteOldFiles"
    status = "Enabled"
    expiration {
      days = 90
    }
  }
}

resource "aws_s3_bucket" "results" {
  bucket = "${local.full_project_name}-results"
}

resource "aws_s3_bucket_server_side_encryption_configuration" "results" {
  bucket = aws_s3_bucket.results.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "results" {
  bucket = aws_s3_bucket.results.id
  rule {
    id     = "MoveToGlacier"
    status = "Enabled"
    transition {
      days          = 30
      storage_class = "GLACIER"
    }
  }
}

# ========================================
# DynamoDB Table
# ========================================
resource "aws_dynamodb_table" "main" {
  name             = "${local.full_project_name}-documents"
  billing_mode     = "PAY_PER_REQUEST"
  hash_key         = "PK"
  range_key        = "SK"
  stream_enabled   = true
  stream_view_type = "NEW_AND_OLD_IMAGES"

  attribute {
    name = "PK"
    type = "S"
  }

  attribute {
    name = "SK"
    type = "S"
  }

  attribute {
    name = "GSI1PK"
    type = "S"
  }

  attribute {
    name = "GSI1SK"
    type = "S"
  }

  global_secondary_index {
    name               = "GSI1"
    hash_key           = "GSI1PK"
    range_key          = "GSI1SK"
    projection_type    = "ALL"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  server_side_encryption {
    enabled = true
  }

  point_in_time_recovery {
    enabled = true
  }
}

# ========================================
# Kinesis Stream
# ========================================
resource "aws_kinesis_stream" "main" {
  name             = "${local.full_project_name}-processing"
  shard_count      = var.kinesis_shard_count
  retention_period = 24
  encryption_type  = "KMS"
  kms_key_id       = "alias/aws/kinesis"
}

# ========================================
# SSM Parameter
# ========================================
resource "aws_ssm_parameter" "gemini_api_key" {
  name        = "/${var.project_name}/${var.environment}/GEMINI_API_KEY"
  description = "Gemini API key for ML processing"
  type        = "SecureString"
  value       = var.gemini_api_key
}

# ========================================
# IAM Roles
# ========================================
resource "aws_iam_role" "ecs_task_role" {
  name = "${local.full_project_name}-ecs-task-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy" "app_permissions" {
  name = "AppPermissions"
  role = aws_iam_role.ecs_task_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = [
          "dynamodb:PutItem",
          "dynamodb:GetItem",
          "dynamodb:UpdateItem",
          "dynamodb:Query",
          "dynamodb:DeleteItem"
        ]
        Effect   = "Allow"
        Resource = aws_dynamodb_table.main.arn
      },
      {
        Action = [
          "s3:PutObject",
          "s3:GetObject",
          "s3:ListBucket",
          "s3:DeleteObject"
        ]
        Effect   = "Allow"
        Resource = [
          aws_s3_bucket.pdfs.arn,
          "${aws_s3_bucket.pdfs.arn}/*",
          aws_s3_bucket.results.arn,
          "${aws_s3_bucket.results.arn}/*"
        ]
      },
      {
        Action = [
          "kinesis:PutRecord",
          "kinesis:PutRecords",
          "kinesis:DescribeStream"
        ]
        Effect   = "Allow"
        Resource = aws_kinesis_stream.main.arn
      },
      {
        Action = [
          "ssm:GetParameter",
          "ssm:GetParameters"
        ]
        Effect   = "Allow"
        Resource = "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/${var.project_name}/${var.environment}/*"
      }
    ]
  })
}

# ========================================
# Lambda Functions
# ========================================
resource "aws_lambda_function" "worker" {
  function_name = "${local.full_project_name}-worker"
  role          = aws_iam_role.ecs_task_role.arn # Reusing role for simplicity, or create dedicated
  handler       = "dist/handler.handler"
  runtime       = "nodejs18.x"
  filename      = "worker.zip" # Placeholder, user needs to build and zip

  environment {
    variables = {
      NODE_ENV               = var.environment
      DYNAMODB_TABLE_NAME    = aws_dynamodb_table.main.name
      S3_BUCKET_NAME         = aws_s3_bucket.pdfs.id
      S3_RESULTS_BUCKET      = aws_s3_bucket.results.id
      KINESIS_STREAM_NAME    = aws_kinesis_stream.main.name
      SSM_PARAMETER_PATH     = "/${var.project_name}/${var.environment}/"
      FILE_SIZE_THRESHOLD_MB = var.file_size_threshold_mb
    }
  }
}

resource "aws_lambda_event_source_mapping" "kinesis" {
  event_source_arn  = aws_kinesis_stream.main.arn
  function_name     = aws_lambda_function.worker.arn
  starting_position = "LATEST"
  batch_size        = 10
}

resource "aws_lambda_function" "aggregator" {
  function_name = "${local.full_project_name}-aggregator"
  role          = aws_iam_role.ecs_task_role.arn
  handler       = "dist/apps/distributed-ml-document-orchestrator/src/aggregator/handler.handler"
  runtime       = "nodejs18.x"
  filename      = "aggregator.zip" # Placeholder

  environment {
    variables = {
      NODE_ENV            = var.environment
      DYNAMODB_TABLE_NAME = aws_dynamodb_table.main.name
      S3_RESULTS_BUCKET   = aws_s3_bucket.results.id
    }
  }
}

resource "aws_lambda_event_source_mapping" "dynamodb" {
  event_source_arn  = aws_dynamodb_table.main.stream_arn
  function_name     = aws_lambda_function.aggregator.arn
  starting_position = "LATEST"
  batch_size        = 1
}

# ========================================
# ECS Cluster & Service
# ========================================
resource "aws_ecs_cluster" "main" {
  name = "${local.full_project_name}-cluster"
}

resource "aws_ecs_task_definition" "app" {
  family                   = "${local.full_project_name}-app"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.ecs_task_execution_role.arn
  task_role_arn            = aws_iam_role.ecs_task_role.arn

  container_definitions = jsonencode([
    {
      name  = "app"
      image = "your-ecr-repo/app:latest" # User needs to provide
      portMappings = [
        {
          containerPort = 3000
          hostPort      = 3000
        }
      ]
      environment = [
        { name = "NODE_ENV", value = var.environment },
        { name = "DYNAMODB_TABLE_NAME", value = aws_dynamodb_table.main.name },
        { name = "S3_BUCKET_NAME", value = aws_s3_bucket.pdfs.id },
        { name = "S3_RESULTS_BUCKET", value = aws_s3_bucket.results.id },
        { name = "KINESIS_STREAM_NAME", value = aws_kinesis_stream.main.name },
        { name = "SSM_PARAMETER_PATH", value = "/${var.project_name}/${var.environment}/" },
        { name = "FILE_SIZE_THRESHOLD_MB", value = tostring(var.file_size_threshold_mb) }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.main.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "ecs"
        }
      }
    }
  ])
}

resource "aws_iam_role" "ecs_task_execution_role" {
  name = "${local.full_project_name}-ecs-exec-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_exec_policy" {
  role       = aws_iam_role.ecs_task_execution_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_cloudwatch_log_group" "main" {
  name              = "/aws/ecs/${local.full_project_name}"
  retention_in_days = 7
}

# ========================================
# Alarms
# ========================================
resource "aws_cloudwatch_metric_alarm" "worker_errors" {
  alarm_name          = "${local.full_project_name}-worker-errors"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "1"
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = "300"
  statistic           = "Sum"
  threshold           = "10"
  alarm_description   = "Alert when worker function has errors"
  dimensions = {
    FunctionName = aws_lambda_function.worker.function_name
  }
}

# ========================================
# Load Balancer (ALB)
# ========================================
resource "aws_lb" "main" {
  name               = "${local.full_project_name}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = [aws_subnet.public_1.id, aws_subnet.public_2.id]
}

resource "aws_lb_target_group" "app" {
  name        = "${local.full_project_name}-tg"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip"

  health_check {
    path                = "/api/health" # Assuming a health check endpoint
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 2
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = "80"
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app.arn
  }
}

resource "aws_security_group" "alb" {
  name        = "${local.full_project_name}-alb-sg"
  description = "Allow HTTP inbound traffic"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "ecs" {
  name        = "${local.full_project_name}-ecs-sg"
  description = "Allow traffic from ALB"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_ecs_service" "app" {
  name            = "${local.full_project_name}-service"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.app.arn
  desired_count   = 2
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = [aws_subnet.public_1.id, aws_subnet.public_2.id]
    security_groups  = [aws_security_group.ecs.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.app.arn
    container_name   = "app"
    container_port   = 3000
  }

  depends_on = [aws_lb_listener.http]
}

data "aws_caller_identity" "current" {}
