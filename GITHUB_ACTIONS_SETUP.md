# GitHub Actions Deployment Setup

This guide walks you through setting up GitHub Actions for automated CDK deployments.

## Prerequisites

- AWS account with administrative access
- GitHub repository with this code
- AWS CLI configured locally

## Step 1: Create OIDC Provider in AWS

The OIDC provider allows GitHub Actions to authenticate with AWS without long-lived credentials.

```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
```

> **Note**: If the OIDC provider already exists, you'll get an error. That's fine - just continue to the next step.

## Step 2: Deploy the CDK Stack

Deploy the stack to create the infrastructure and IAM role:

```bash
npm install
npm run build
npx cdk bootstrap  # Only needed once per account/region
npx cdk deploy
```

After deployment, note the outputs:
- `BucketName`: Your S3 bucket name
- `DistributionId`: CloudFront distribution ID
- `DeploymentRoleArn`: IAM role ARN for GitHub Actions

## Step 3: Update IAM Role Trust Policy

For security, restrict the IAM role to your specific repository:

1. Go to AWS IAM Console
2. Find the role named `FredjeanNetStack-GitHubDeploymentRole...`
3. Edit the Trust Policy to specify your repository:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::YOUR_ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:fredjean/fredjean-net-cdk:*"
        }
      }
    }
  ]
}
```

Replace:
- `YOUR_ACCOUNT_ID` with your AWS account ID
- `fredjean/fredjean-net-cdk` with your repository path

## Step 4: Configure GitHub Secrets

Add these secrets to your GitHub repository:

1. Go to your repository on GitHub
2. Navigate to **Settings** → **Secrets and variables** → **Actions**
3. Add the following repository secrets:

| Secret Name | Value | Example |
|-------------|-------|---------|
| `AWS_ROLE_ARN` | The DeploymentRoleArn from CDK outputs | `arn:aws:iam::123456789012:role/...` |
| `AWS_REGION` | AWS region where stack is deployed | `us-east-1` |
| `S3_BUCKET_NAME` | The BucketName from CDK outputs | `example-com-website` |
| `CLOUDFRONT_DISTRIBUTION_ID` | The DistributionId from CDK outputs | `E1234567890ABC` |

## Step 5: Test the Workflow

### Test Infrastructure Deployment

1. Make a change to the infrastructure code
2. Commit and push to a branch
3. Create a pull request to see the `cdk diff`
4. Merge to main to trigger deployment

### Test Website Deployment

1. Create a `website/` directory in your repository
2. Add your static website files (index.html, etc.)
3. Commit and push to main
4. The workflow will sync files to S3 and invalidate CloudFront cache

## Workflow Files

### Infrastructure Deployment (`.github/workflows/deploy.yml`)

Triggers on:
- Push to main branch
- Pull requests to main
- Manual workflow dispatch

Actions:
- Runs tests
- Shows `cdk diff` on PRs
- Deploys infrastructure on push to main

### Website Content Deployment (`.github/workflows/deploy-website.yml`)

Triggers on:
- Push to main when `website/**` files change
- Manual workflow dispatch

Actions:
- Syncs website files to S3
- Invalidates CloudFront cache

## Troubleshooting

### "Not authorized to perform: sts:AssumeRoleWithWebIdentity"

- Verify the OIDC provider exists in your AWS account
- Check that the trust policy is correctly configured
- Ensure the repository path in the trust policy matches your repo

### "Access Denied" when uploading to S3

- Verify the IAM role has the correct S3 permissions
- Check that the bucket name in secrets matches the actual bucket

### CloudFront invalidation fails

- Verify the distribution ID is correct
- Check that the IAM role has CloudFront invalidation permissions

### CDK deployment fails with "Cannot find module"

- Ensure `npm ci` runs before `npm run build`
- Check that all dependencies are in package.json

## Security Considerations

1. **Never commit AWS credentials** - Use OIDC authentication only
2. **Restrict IAM role** - Update trust policy to your specific repository
3. **Use branch protection** - Require reviews before merging to main
4. **Review CloudFormation changes** - Always check `cdk diff` output
5. **Monitor CloudWatch** - Set up alarms for unusual activity

## Manual Deployment (Without GitHub Actions)

If you prefer to deploy manually:

```bash
# Deploy infrastructure
npm run build
npx cdk deploy

# Upload website
aws s3 sync ./website s3://YOUR-BUCKET-NAME

# Invalidate cache
aws cloudfront create-invalidation \
  --distribution-id YOUR-DISTRIBUTION-ID \
  --paths "/*"
```

## Next Steps

- Set up custom domain (see EXAMPLES.md)
- Configure monitoring and alerts
- Add more sophisticated deployment strategies (blue/green, canary)
- Integrate with other GitHub Actions workflows
