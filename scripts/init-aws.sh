#!/bin/bash

# ==============================================================================
# WARNING: LOCAL DEVELOPMENT ONLY
# This script is designed to initialize resources in LocalStack (AWS Emulator).
# DO NOT run this against a production AWS environment.
# For production deployment, use AWS SAM or Terraform in the /infrastructure dir.
# ==============================================================================

# LocalStack initialization script
# This script runs when LocalStack is ready

echo "Initializing LocalStack AWS resources..."

# Wait for LocalStack to be ready
sleep 5

# Set AWS endpoint
export AWS_ENDPOINT_URL=http://localhost:4566
export AWS_REGION=us-east-1
export AWS_ACCESS_KEY_ID=test
export AWS_SECRET_ACCESS_KEY=test

# S3 Bucket Initialization
# These buckets store the raw PDF uploads and the final aggregated analysis results.
echo "Creating S3 buckets..."

awslocal s3 mb s3://document-orchestrator-pdfs
awslocal s3 mb s3://document-orchestrator-results

# Enable versioning
awslocal s3api put-bucket-versioning \
  --bucket document-orchestrator-pdfs \
  --versioning-configuration Status=Enabled

echo "S3 buckets created"

# DynamoDB Table Setup
# A single-table design is used to manage file metadata, document status, and page analysis results.
echo "Creating DynamoDB table..."

awslocal dynamodb create-table \
  --table-name DocumentOrchestrator \
  --attribute-definitions \
    AttributeName=PK,AttributeType=S \
    AttributeName=SK,AttributeType=S \
    AttributeName=GSI1PK,AttributeType=S \
    AttributeName=GSI1SK,AttributeType=S \
  --key-schema \
    AttributeName=PK,KeyType=HASH \
    AttributeName=SK,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST \
  --global-secondary-indexes \
    "[
      {
        \"IndexName\": \"GSI1\",
        \"KeySchema\": [
          {\"AttributeName\":\"GSI1PK\",\"KeyType\":\"HASH\"},
          {\"AttributeName\":\"GSI1SK\",\"KeyType\":\"RANGE\"}
        ],
        \"Projection\": {\"ProjectionType\":\"ALL\"}
      }
    ]" \
  --stream-specification \
    StreamEnabled=true,StreamViewType=NEW_AND_OLD_IMAGES

# Wait for table to be active
sleep 3

echo "DynamoDB table created with single-table design"
echo "  - Supports FileMetadata (PK: FILE#<id>, SK: METADATA)"
echo "  - Supports DocumentStatus (PK: DOC#<id>, SK: STATUS)"
echo "  - Supports DocumentPages (PK: DOC#<id>, SK: PAGE#<num>)"

# Kinesis Stream Configuration
# This stream handles the asynchronous event flow for document processing.
echo "Creating Kinesis stream..."

awslocal kinesis create-stream \
  --stream-name document-processing-stream \
  --shard-count 1

# Wait for stream to be active
sleep 3

echo "Kinesis stream created"

# IAM Role and Policy Configuration
# Defines the necessary permissions for Lambda functions to interact with S3, DynamoDB, and Kinesis.
echo "Creating IAM roles..."

# Lambda execution role
awslocal iam create-role \
  --role-name lambda-execution-role \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": {"Service": "lambda.amazonaws.com"},
      "Action": "sts:AssumeRole"
    }]
  }'

# Attach policies
awslocal iam attach-role-policy \
  --role-name lambda-execution-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

awslocal iam attach-role-policy \
  --role-name lambda-execution-role \
  --policy-arn arn:aws:iam::aws:policy/AmazonDynamoDBFullAccess

awslocal iam attach-role-policy \
  --role-name lambda-execution-role \
  --policy-arn arn:aws:iam::aws:policy/AmazonS3FullAccess

awslocal iam attach-role-policy \
  --role-name lambda-execution-role \
  --policy-arn arn:aws:iam::aws:policy/AmazonKinesisFullAccess

awslocal iam attach-role-policy \
  --role-name lambda-execution-role \
  --policy-arn arn:aws:iam::aws:policy/AmazonSSMReadOnlyAccess

echo "IAM roles created"

# SSM Parameter Store Setup
# Stores sensitive configuration like API keys.
echo "Creating SSM parameters..."

awslocal ssm put-parameter \
  --name "/document-orchestrator/development/GEMINI_API_KEY" \
  --type "String" \
  --value "test-gemini-api-key" \
  --overwrite

echo "SSM parameters created"

# Seed Data
# Populates the database with initial test data, including a default tenant and API key.
echo "Seeding test data..."

# Create a test tenant
awslocal dynamodb put-item \
  --table-name DocumentOrchestrator \
  --item '{
    "PK": {"S": "TENANT#test"},
    "SK": {"S": "METADATA"},
    "tenantName": {"S": "Test Tenant"},
    "apiKey": {"S": "test-api-key"},
    "createdAt": {"S": "'$(date -u +"%Y-%m-%dT%H:%M:%SZ")'"}
  }'

echo "Test data seeded"

echo "========================================="
echo "LocalStack initialization complete!"
echo "========================================="
echo "S3 Buckets:"
echo "  - document-orchestrator-pdfs"
echo "  - document-orchestrator-results"
echo ""
echo "DynamoDB Tables:"
echo "  - DocumentOrchestrator"
echo ""
echo "Kinesis Streams:"
echo "  - document-processing-stream"
echo ""
echo "Test Credentials:"
echo "  API Key: test-api-key"
echo "  Tenant ID: test"
echo "========================================="
