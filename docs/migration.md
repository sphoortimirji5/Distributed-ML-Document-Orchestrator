# Migration Guide

This document covers data migrations, schema changes, and infrastructure evolution strategies. For deployment, see [cicd.md](cicd.md).

---

## Local to Production

| Component | Local | Production | Notes |
|-----------|-------|------------|-------|
| **LLM Provider** | Gemini (API key) | Bedrock (IAM) | Set `LLM_PROVIDER=bedrock` |
| **Networking** | Docker bridge | AWS VPC | Terraform creates VPC |
| **Compute** | Local Node.js | ECS Fargate | CI/CD builds & pushes image |
| **Credentials** | `.env` file | IAM Task Roles | No static credentials |
