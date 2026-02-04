# Production Deployment Guide

This document provides detailed information on deploying the Distributed ML Document Orchestrator to AWS and managing the production environment.

## Infrastructure Requirements

| Component | Specification |
|-----------|---------------|
| **ECS Fargate (API)** | 0.5 vCPU, 1 GB RAM (auto-scale to 10 tasks) |
| **ECS Fargate (Consumer)** | 0.5 vCPU, 1 GB RAM (auto-scale based on Kinesis depth) |
| **Lambda (Worker)** | 512 MB, 50 reserved concurrent executions |
| **Lambda (Aggregator)** | 512 MB, triggered by DynamoDB Streams |
| **DynamoDB** | On-Demand (PAY_PER_REQUEST), GSI for tenant queries |
| **Kinesis** | 1 shard minimum (scale to 10 based on throughput) |
| **S3** | AES-256 encryption, lifecycle policies |
| **VPC** | 2+ AZs, public + private subnets |

## Environment Variables

Production environment variables stored in AWS SSM Parameter Store:

```env
# Application
NODE_ENV=production
PORT=3000

# AWS (retrieved via IAM Task Roles - no static credentials)
AWS_REGION=us-east-1

# S3 (from CloudFormation/Terraform outputs)
S3_BUCKET_NAME=<stack-name>-pdfs-production
S3_RESULTS_BUCKET=<stack-name>-results-production

# DynamoDB
DYNAMODB_TABLE_NAME=<stack-name>-documents-production

# Kinesis
KINESIS_STREAM_NAME=<stack-name>-processing-production

# LLM Provider Configuration (AWS Bedrock)
LLM_PROVIDER=bedrock
BEDROCK_MODEL=anthropic.claude-3-sonnet-20240229-v1:0
# No API key needed - uses IAM Task Role authentication

# Document Reaper (stuck document recovery)
REAPER_STUCK_THRESHOLD_MINS=30
REAPER_CRON_EXPRESSION=0 */5 * * * *

# Tuning
FILE_SIZE_THRESHOLD_MB=2

# Logging
LOG_LEVEL=info
```

## LLM Provider Configuration

### Using AWS Bedrock in Production 

Bedrock uses IAM authentication - no API keys in environment variables:

1. **Set the provider:**
   ```bash
   LLM_PROVIDER=bedrock
   BEDROCK_MODEL=anthropic.claude-3-sonnet-20240229-v1:0
   ```

2. **IAM Permissions (automatically configured):**
   The ECS Task Role has `bedrock:InvokeModel` permission for supported models.

3. **Benefits:**
   - No API keys to manage or rotate
   - IAM access logging and auditing
   - VPC endpoint support for private connectivity
   - Pay-per-use pricing

## Deployment 

### Terraform

Terraform provides a more granular approach to infrastructure management, ideal for complex multi-account setups.

**1. Initialize Terraform:**
```bash
cd infrastructure/terraform
terraform init
```

**2. Configure variables:**
```bash
cp terraform.tfvars.example terraform.tfvars
```

**3. Deploy:**
```bash
terraform plan
terraform apply
```

**4. Terraform will create:**
- **Networking**: VPC, Public Subnets, Internet Gateway, Route Tables
- **Load Balancing**: Application Load Balancer with Target Groups
- **Compute**: ECS Fargate Cluster and Service with auto-scaling
- **Serverless**: Worker and Aggregator Lambda functions
- **Storage & DB**: S3 buckets (encrypted) and DynamoDB (with GSI and Streams)
- **Security**: Granular IAM Roles and SSM Parameter Store for secrets




## Cost Optimization

### Free Tier Usage
- **S3**: 5GB storage, 20K GET, 2K PUT/month
- **DynamoDB**: 25GB storage, 25 RCU/WCU
- **Lambda**: 1M requests, 400K GB-seconds/month

### Estimated Monthly Costs (beyond free tier)

| Service | Cost |
|---------|------|
| Kinesis Data Streams (1 shard) | ~$11 |
| Lambda (moderate usage) | $0-5 |
| ECS Fargate (2 tasks) | ~$30-40 |
| Data transfer | ~$5-10 |
| **Total** | **~$50-70/month** |


### Summary

| Security Aspect | Implementation |
|-----------------|----------------|
| **Credentials** | Zero static credentials; IAM Task Roles |
| **Secrets** | SSM Parameter Store with KMS encryption |
| **Encryption at Rest** | S3 AES-256, DynamoDB AWS-managed |
| **Encryption in Transit** | HTTPS/TLS 1.2+ |
| **Network** | VPC isolation, Security Groups |


---
**Note**: Always test deployments in a staging environment before applying to production.
