# fredjean-net-cdk

CDK package to create the infrastructure needed to deploy a static website on S3, fronted by CloudFront

## Architecture

```
┌─────────────────┐
│   GitHub        │
│   Actions       │
│   (CI/CD)       │
└────────┬────────┘
         │ OIDC Auth
         ▼
┌─────────────────────────────────────────────────────────────┐
│                        AWS Account                          │
│                                                             │
│  ┌──────────────┐                                          │
│  │     IAM      │                                          │
│  │  Deployment  │                                          │
│  │     Role     │                                          │
│  └──────┬───────┘                                          │
│         │                                                   │
│         │ Upload Files    ┌─────────────────┐             │
│         └────────────────►│       S3        │             │
│                           │  Static Website │             │
│         ┌─────────────────┤     Bucket      │             │
│         │                 └────────┬────────┘             │
│         │                          │                       │
│         │ Create Invalidation      │ Origin               │
│         │                          │                       │
│         ▼                          ▼                       │
│  ┌──────────────┐          ┌──────────────┐               │
│  │  CloudFront  │◄─────────│    Origin    │               │
│  │ Distribution │          │    Access    │               │
│  │              │          │   Control    │               │
│  └──────┬───────┘          └──────────────┘               │
│         │                                                   │
│         │ (Optional)                                        │
│         ▼                                                   │
│  ┌──────────────┐          ┌──────────────┐               │
│  │     ACM      │          │   Route 53   │               │
│  │ Certificate  │          │  DNS Records │               │
│  └──────────────┘          └──────────────┘               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
         │
         │ HTTPS
         ▼
┌─────────────────┐
│   End Users     │
└─────────────────┘
```

## Overview

This AWS CDK package creates all the infrastructure needed to host a static website using:
- **S3** for storing website files
- **CloudFront** for global content delivery
- **ACM** for SSL/TLS certificates (optional)
- **Route53** for DNS management (optional)
- **IAM** roles for GitHub Actions deployment

## Quick Start

### 1. Clone and Install

```bash
git clone https://github.com/fredjean/fredjean-net-cdk.git
cd fredjean-net-cdk
npm install
```

### 2. Bootstrap AWS Account (first time only)

```bash
npx cdk bootstrap
```

### 3. Deploy the Infrastructure

```bash
npm run build
npx cdk deploy
```

### 4. Upload Your Website

After deployment, upload your static website files:

```bash
# Get the bucket name from CDK outputs
aws s3 sync ./your-website s3://YOUR-BUCKET-NAME
```

That's it! Your website is now live on CloudFront.

## Prerequisites

- Node.js 20.x or later
- npm 10.x or later
- AWS CLI configured with appropriate credentials
- AWS CDK CLI (`npm install -g aws-cdk`)

## Installation

```bash
npm install
```

## Configuration

The stack accepts the following optional parameters:

- `domainName`: Your custom domain (e.g., `fredjean.net`)
- `hostedZoneId`: Route53 hosted zone ID for your domain
- `certificateArn`: ARN of an ACM certificate (must be in us-east-1 for CloudFront)

You can configure these in `bin/fredjean-net-cdk.ts`.

## Usage

### Build

```bash
npm run build
```

### Test

```bash
npm test
```

### Deploy

First, bootstrap your AWS account for CDK (if not already done):

```bash
cdk bootstrap
```

Then deploy the stack:

```bash
cdk deploy
```

### View Differences

Before deploying, you can preview what will be created:

```bash
cdk diff
```

### Synthesize CloudFormation Template

To see the CloudFormation template that will be deployed:

```bash
cdk synth
```

## GitHub Actions Setup

### 1. Create OIDC Provider

First, create an OIDC provider in your AWS account for GitHub Actions:

```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
```

### 2. Deploy the Stack

Deploy the CDK stack which will create the deployment role:

```bash
cdk deploy
```

### 3. Configure GitHub Secrets

Add the following secrets to your GitHub repository:

- `AWS_ROLE_ARN`: The ARN of the deployment role (from CDK outputs)
- `AWS_REGION`: The AWS region (e.g., `us-east-1`)

### 4. Update Trust Policy

After deployment, update the GitHub deployment role's trust policy to restrict it to your specific repository. See [GITHUB_ACTIONS_SETUP.md](GITHUB_ACTIONS_SETUP.md) for detailed instructions.

For a complete step-by-step guide, see **[GitHub Actions Setup Guide](GITHUB_ACTIONS_SETUP.md)**.

## Deploying Website Content

Once the infrastructure is deployed, you can upload your static website files to the S3 bucket:

```bash
# Upload files
aws s3 sync ./your-website-files s3://YOUR-BUCKET-NAME

# Invalidate CloudFront cache
aws cloudfront create-invalidation \
  --distribution-id YOUR-DISTRIBUTION-ID \
  --paths "/*"
```

## Stack Outputs

After deployment, the stack provides these outputs:

- **BucketName**: S3 bucket name for website content
- **DistributionId**: CloudFront distribution ID
- **DistributionDomainName**: CloudFront URL for your website
- **DeploymentRoleArn**: IAM role ARN for GitHub Actions

## Project Structure

```
.
├── bin/
│   └── fredjean-net-cdk.ts    # CDK app entry point
├── lib/
│   └── static-website-stack.ts # Main stack definition
├── test/
│   └── static-website-stack.test.ts # Unit tests
├── .github/
│   └── workflows/
│       └── deploy.yml          # GitHub Actions workflow
├── cdk.json                    # CDK configuration
├── tsconfig.json               # TypeScript configuration
└── package.json                # Node.js dependencies
```

## Customization

To customize the stack for your domain, edit `bin/fredjean-net-cdk.ts`:

```typescript
new StaticWebsiteStack(app, 'FredjeanNetStack', {
  env: { 
    account: process.env.CDK_DEFAULT_ACCOUNT, 
    region: process.env.CDK_DEFAULT_REGION 
  },
  domainName: 'fredjean.net',
  hostedZoneId: 'Z1234567890ABC',
  certificateArn: 'arn:aws:acm:us-east-1:123456789012:certificate/...',
});
```

## Security Features

- S3 bucket has public access blocked
- HTTPS enforced on CloudFront
- S3 bucket requires SSL for all connections
- Origin Access Control used instead of Origin Access Identity
- IAM role follows principle of least privilege

## Cost Considerations

- **S3**: Pay for storage and requests
- **CloudFront**: Free tier includes 1TB data transfer out and 10M requests per month
- **Route53**: $0.50/month per hosted zone (if used)
- **ACM**: Free for public certificates

## Cleanup

To delete all resources created by this stack:

```bash
cdk destroy
```

**Note**: The S3 bucket has a `RETAIN` removal policy, so it won't be automatically deleted. You'll need to empty and delete it manually if desired.

## License

ISC
