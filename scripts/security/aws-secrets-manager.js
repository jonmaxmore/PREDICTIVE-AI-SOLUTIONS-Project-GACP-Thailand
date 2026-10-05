#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

class AWSSecretsManager {
  constructor() {
    this.secretsConfig = {
      region: process.env.AWS_REGION || 'ap-southeast-1',
      secretName: process.env.SECRET_NAME || 'gacp-platform/production'
    };
  }

  generateTerraformConfig() {
    return `# AWS Secrets Manager Configuration
# Terraform configuration for GACP Platform secrets

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "${this.secretsConfig.region}"
}

resource "aws_secretsmanager_secret" "gacp_secrets" {
  name        = "${this.secretsConfig.secretName}"
  description = "GACP Platform production secrets"
  
  recovery_window_in_days = 7
  
  tags = {
    Environment = "production"
    Application = "gacp-platform"
    ManagedBy   = "terraform"
  }
}

resource "aws_secretsmanager_secret_version" "gacp_secrets_version" {
  secret_id = aws_secretsmanager_secret.gacp_secrets.id
  secret_string = jsonencode({
    Applicant_JWT_SECRET     = var.Applicant_jwt_secret
    DTAM_JWT_SECRET       = var.dtam_jwt_secret
    DATABASE_URL         = var.database_url
    REDIS_URL             = var.redis_url
    AWS_ACCESS_KEY_ID     = var.aws_access_key
    AWS_SECRET_ACCESS_KEY = var.aws_secret_key
    PAYMENT_SECRET_KEY    = var.payment_secret
  })
}

variable "Applicant_jwt_secret" {
  type      = string
  sensitive = true
}

variable "dtam_jwt_secret" {
  type      = string
  sensitive = true
}

variable "database_url" {
  type      = string
  sensitive = true
}

variable "redis_url" {
  type      = string
  sensitive = true
}

variable "aws_access_key" {
  type      = string
  sensitive = true
}

variable "aws_secret_key" {
  type      = string
  sensitive = true
}

variable "payment_secret" {
  type      = string
  sensitive = true
}

output "secret_arn" {
  value       = aws_secretsmanager_secret.gacp_secrets.arn
  description = "ARN of the secrets manager secret"
}
`;
  }

  generateNodeJSClient() {
    return `// AWS Secrets Manager Client for Node.js
// Usage: const secrets = await loadSecrets();

const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

const client = new SecretsManagerClient({
  region: process.env.AWS_REGION || 'ap-southeast-1',
});

async function loadSecrets() {
  try {
    const response = await client.send(
      new GetSecretValueCommand({
        SecretId: process.env.SECRET_NAME || 'gacp-platform/production',
      })
    );

    if (response.SecretString) {
      return JSON.parse(response.SecretString);
    }

    throw new Error('Secret not found');
  } catch (error) {
    console.error('Failed to load secrets:', error);
    throw error;
  }
}

async function initializeSecrets() {
  if (process.env.NODE_ENV === 'production') {
    const secrets = await loadSecrets();
    Object.assign(process.env, secrets);
    console.log('Secrets loaded from AWS Secrets Manager');
  } else {
    console.log('ℹ️  Using local environment variables');
  }
}

module.exports = { loadSecrets, initializeSecrets };
`;
  }

  generateDockerConfig() {
    return `# Docker configuration for AWS Secrets Manager
# Add to your Dockerfile

FROM node:18-alpine

# Install AWS CLI
RUN apk add --no-cache aws-cli

# Copy application
WORKDIR /app
COPY . .

# Install dependencies
RUN npm ci --only=production

# Entrypoint script to load secrets
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
`;
  }

  generateEntrypoint() {
    return `#!/bin/sh
# Docker entrypoint script to load AWS secrets

set -e

if [ "$NODE_ENV" = "production" ]; then
  echo "Loading secrets from AWS Secrets Manager..."
  
  SECRET_JSON=$(aws secretsmanager get-secret-value \\
    --secret-id \${SECRET_NAME} \\
    --region \${AWS_REGION} \\
    --query SecretString \\
    --output text)
  
  export Applicant_JWT_SECRET=$(echo $SECRET_JSON | jq -r '.Applicant_JWT_SECRET')
  export DTAM_JWT_SECRET=$(echo $SECRET_JSON | jq -r '.DTAM_JWT_SECRET')
  export DATABASE_URL=$(echo $SECRET_JSON | jq -r '.DATABASE_URL')
  export REDIS_URL=$(echo $SECRET_JSON | jq -r '.REDIS_URL')
  
  echo "✅ Secrets loaded successfully"
fi

exec "$@"
`;
  }

  generate() {
    const outputDir = path.join(process.cwd(), 'infrastructure', 'aws-secrets');

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(path.join(outputDir, 'secrets.tf'), this.generateTerraformConfig());
    fs.writeFileSync(path.join(outputDir, 'secrets-client.js'), this.generateNodeJSClient());
    fs.writeFileSync(path.join(outputDir, 'Dockerfile.secrets'), this.generateDockerConfig());
    fs.writeFileSync(path.join(outputDir, 'docker-entrypoint.sh'), this.generateEntrypoint());

    console.log('AWS Secrets Manager configuration generated');
    console.log(`Output directory: ${outputDir}`);
    console.log('\nNext steps:');
    console.log('1. Review and customize secrets.tf');
    console.log('2. Run: terraform init && terraform plan');
    console.log('3. Run: terraform apply');
    console.log('4. Update backend to use secrets-client.js');
  }
}

const manager = new AWSSecretsManager();
manager.generate();
