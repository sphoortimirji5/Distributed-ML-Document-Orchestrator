# Production Deployment & Architecture

This document provides detailed information on deploying the Distributed ML Document Orchestrator to AWS and managing the production environment.

## Production Architecture

The production environment utilizes AWS Serverless and Containerized services for maximum scalability.

- **API/Orchestrator**: NestJS running on ECS Fargate with **IAM Task Roles**.
- **Workers**: Containerized Consumer Service with **IAM Task Roles** for heavy lifting.
- **Aggregation**: AWS Lambda triggered by DynamoDB Streams, using **IAM Execution Roles**.
- **Storage**: S3 for blobs, DynamoDB for structured data/status.
- **Streaming**: Kinesis for high-throughput event distribution.
- **Secrets & Config**: **AWS SSM Parameter Store** for managing API keys and sensitive configuration.

## Multi-tenancy & Data Isolation

The system is built with a multi-tenant architecture, ensuring strict data isolation between different clients.

- **Storage Isolation**: All files in S3 are prefixed with the `tenantId` (e.g., `s3://bucket/{tenantId}/{fileId}/...`). This allows for granular IAM policies and prevents cross-tenant data access.
- **Database Isolation**: DynamoDB uses a composite primary key where the Partition Key (PK) or a Global Secondary Index (GSI) includes the `tenantId`. This ensures that queries are scoped to a specific tenant.
- **API Security**: Every request must include a `tenantId`, which is validated against the authenticated context (e.g., via API Keys or IAM roles) to ensure users only access their own data.

## Client & Frontend Integration

If you plan to connect a web frontend or external client to this API, consider the following integration patterns:

### 1. Authentication
- **API Keys**: Simplest for server-to-server or private client integration. Pass the key in the `X-API-Key` header.
- **JWT (JSON Web Tokens)**: If building a user-facing frontend, you can integrate JWT. The API would issue a token upon login, which the client includes in the `Authorization: Bearer <token>` header.
- **Cognito/Auth0**: For production-grade user management, use a provider like AWS Cognito. The API can then validate the JWTs issued by the provider.

### 2. CORS (Cross-Origin Resource Sharing)
By default, the API may block requests from different domains. To enable frontend access, configure CORS in `main.ts`:
```typescript
app.enableCors({
  origin: 'https://your-frontend-domain.com',
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
  credentials: true,
});
```

### 3. Efficient File Uploads
For large PDFs, avoid proxying the file through the API. Instead:
1. Client requests a **Presigned Upload URL** from the API.
2. Client uploads the file **directly to S3**.
3. Client notifies the API once the upload is complete to trigger processing.

### 4. Real-time Updates
Since document processing is asynchronous, the frontend can:
- **Poll**: Periodically call the `/jobs/:id` endpoint.
- **WebSockets**: Implement a WebSocket gateway in NestJS to push status updates to the client.
- **Webhooks**: Provide a callback URL that the API calls once processing is finished.

## Deployment Options

### Option 1: AWS SAM (Serverless Application Model)

**1. Install SAM CLI:**
```bash
brew install aws-sam-cli  # macOS
# or
pip install aws-sam-cli
```

**2. Deploy Infrastructure:**

```bash
# Build
sam build

# Deploy (first time - guided)
sam deploy --guided

# Subsequent deploys
sam deploy
```

**3. SAM will create:**
- S3 buckets (with encryption and lifecycle rules)
- DynamoDB tables (with GSI, Streams, and TTL)
- Kinesis Data Stream (with KMS encryption)
- Lambda functions for workers and aggregation
- ECS Fargate services for API Gateway & Orchestrator
- **IAM Roles & Policies** (Task Roles vs. Execution Roles)
- **SSM Parameter Store** (for secure secret management)
- CloudWatch Log Groups & Alarms
- VPC, Subnets, and Security Groups

### Option 2: Terraform

Terraform provides a more granular approach to infrastructure management, ideal for complex multi-account setups.

**1. Initialize Terraform:**

```bash
cd infrastructure/terraform
terraform init
```

**2. Configure variables:**

Copy the example variables file and fill in your details:
```bash
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your GEMINI_API_KEY and other settings
```

**3. Deploy:**

```bash
terraform plan
terraform apply
```

**4. Terraform will create:**
- **Networking**: VPC, Public Subnets, Internet Gateway, and Route Tables.
- **Load Balancing**: Application Load Balancer (ALB) with Target Groups and Listeners.
- **Compute**: ECS Fargate Cluster and Service with auto-scaling capabilities.
- **Serverless**: Worker and Aggregator Lambda functions with event source mappings.
- **Storage & DB**: S3 buckets (encrypted) and DynamoDB (with GSI and Streams).
- **Security**: Granular IAM Roles (Task vs. Execution) and SSM Parameter Store for secrets.

## Cost Optimization

**Free Tier Usage:**
- **S3**: 5GB storage, 20K GET, 2K PUT/month
- **DynamoDB**: 25GB storage, 25 RCU/WCU
- **Lambda**: 1M requests, 400K GB-seconds/month

**Estimated Monthly Costs (beyond free tier):**
- Kinesis Data Streams (1 shard): ~$11
- Lambda (moderate usage): $0-5
- ECS Fargate (2 tasks): ~$30-40
- Data transfer: ~$5-10

**Total: ~$50-70/month** for moderate production workload

**Cost Reduction Tips:**
1. Use **Lambda for all services** (API Gateway + Orchestrator) - reduces ECS costs
2. Enable **DynamoDB auto-scaling** - pay only for what you use
3. Set **S3 lifecycle policies** - move old files to Glacier
4. Use **CloudWatch alarms** - monitor and optimize
5. Enable **DynamoDB TTL** - auto-delete old chunks

## Tuning & Thresholds

The `FILE_SIZE_THRESHOLD_MB` setting is critical for balancing performance and reliability.

### Synchronous vs. Asynchronous
- **Synchronous (Small Files)**: Fast, immediate response. Limited by the **29-second AWS API Gateway timeout**.
- **Asynchronous (Large Files)**: Resilient, handles heavy processing. Recommended for any document that takes >20 seconds to process.

### Recommendations
| Use Case | Threshold | Rationale |
| :--- | :--- | :--- |
| **Standard Web App** | **1 MB - 2 MB** | Snappy UX for small PDFs; offloads risk to background. |
| **Batch Processing** | **0 MB** | Always async; most resilient for high-volume workloads. |
| **High Performance** | **5 MB** | Only if using fast models (e.g., Gemini Flash) to stay under 29s. |

### Latency Factors
- **Gemini API**: Typically 3-5 seconds per page.
- **PDF Parsing**: Increases with file complexity and page count.
- **Network Transfer**: S3 upload/download time for very large files.

## Security & Compliance

The system is designed with a "Security First" mindset, following the AWS Well-Architected Framework.

### Identity & Access Management (IAM)
- **Zero Static Credentials**: No AWS Access Keys or Secret Keys are stored in the application or environment variables.
- **Task Roles vs. Execution Roles**:
  - **Task Role**: Used by the application code (NestJS) to access S3, DynamoDB, Kinesis, and **SSM Parameter Store** (for secrets). The AWS SDK automatically fetches temporary credentials from the ECS metadata service.
  - **Task Execution Role**: Used by the ECS agent to pull container images from ECR and send logs to CloudWatch.
- **Least Privilege**: Each component is assigned a dedicated IAM Role with granular policies (e.g., `s3:PutObject` only for the specific results bucket).
- **Runtime Retrieval**: The AWS SDK v3 detects the ECS environment and automatically handles credential rotation via the `AWS_CONTAINER_CREDENTIALS_RELATIVE_URI` environment variable.

### Secret Management
- **AWS SSM Parameter Store**: Sensitive data like the `GEMINI_API_KEY` is stored securely in SSM Parameter Store.
- **Runtime Retrieval**: The application fetches secrets at startup or runtime, ensuring they are never committed to version control or exposed in logs.
- **Encryption**: All parameters are encrypted at rest using AWS KMS.

### Data Protection
- **Encryption at Rest**: S3 buckets use AES-256 server-side encryption. DynamoDB tables use AWS-managed encryption.
- **Encryption in Transit**: All API communication is forced over HTTPS (TLS 1.2+).
- **Secure Downloads**: Results are accessed via short-lived (1-hour) S3 pre-signed URLs.

### Network Security
- **VPC Isolation**: ECS services run within private subnets with no direct internet access.
- **Security Groups**: Strict ingress/egress rules control traffic between the Load Balancer, ECS tasks, and AWS services.
