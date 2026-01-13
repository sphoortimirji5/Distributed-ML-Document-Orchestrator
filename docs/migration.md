# Migration Guide

## Purpose
This document outlines the strategy for migrating between different infrastructure environments and evolving system components without data loss or service interruption.

## Infrastructure Migration (SAM to Terraform)
The project supports both AWS SAM and Terraform. Migration from SAM to Terraform is recommended for production environments requiring granular networking control.

### Steps
1. **State Discovery**: Identify existing S3 buckets and DynamoDB tables created by SAM.
2. **Resource Import**: Use `terraform import` to bring existing resources under Terraform management.
3. **Traffic Shift**: Update the Application Load Balancer (ALB) listener rules to point to the new ECS services managed by Terraform.
4. **Decommission**: Once verified, run `sam delete` to remove the old stack.

## Component Migration
### Local to Production
- **Secrets**: Transition from `.env` files to **AWS SSM Parameter Store**.
- **Networking**: Move from Docker bridge networks to **AWS VPC** with private subnets.
- **Compute**: Shift from local Node.js processes to **ECS Fargate** tasks.

## Data Migration
### DynamoDB Schema Changes
- **Strategy**: Use the "Expand and Contract" pattern.
- **Steps**:
    1. Add new optional attributes.
    2. Update application code to write to both old and new attributes.
    3. Backfill existing records using a migration script.
    4. Update application code to read from the new attribute.
    5. Remove old attributes.

---
**Note**: All migrations must be verified in the staging environment before applying to production.
