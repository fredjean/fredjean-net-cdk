# Example CDK Configuration

This file shows example configurations for different use cases.

## Basic Configuration (No Custom Domain)

In `bin/fredjean-net-cdk.ts`:

```typescript
#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { StaticWebsiteStack } from '../lib/static-website-stack';

const app = new cdk.App();
new StaticWebsiteStack(app, 'MyWebsiteStack', {
  env: { 
    account: process.env.CDK_DEFAULT_ACCOUNT, 
    region: process.env.CDK_DEFAULT_REGION 
  },
});
```

## Configuration with Custom Domain

In `bin/fredjean-net-cdk.ts`:

```typescript
#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { StaticWebsiteStack } from '../lib/static-website-stack';

const app = new cdk.App();
new StaticWebsiteStack(app, 'FredjeanNetStack', {
  env: { 
    account: process.env.CDK_DEFAULT_ACCOUNT, 
    region: 'us-east-1' // Must be us-east-1 for CloudFront certificates
  },
  domainName: 'fredjean.net',
  hostedZoneId: 'Z1234567890ABC', // Get from Route53
  certificateArn: 'arn:aws:acm:us-east-1:123456789012:certificate/12345678-1234-1234-1234-123456789012',
});
```

## Creating an ACM Certificate

Before deploying with a custom domain, create an ACM certificate in us-east-1:

```bash
# Request a certificate
aws acm request-certificate \
  --domain-name fredjean.net \
  --validation-method DNS \
  --region us-east-1

# Get the certificate ARN from the output and add it to your stack configuration
```

## Finding Your Hosted Zone ID

```bash
# List hosted zones
aws route53 list-hosted-zones

# Look for your domain and note the HostedZoneId
```

## Environment Variables

You can also use environment variables for configuration:

```typescript
new StaticWebsiteStack(app, 'FredjeanNetStack', {
  env: { 
    account: process.env.CDK_DEFAULT_ACCOUNT, 
    region: process.env.AWS_REGION || 'us-east-1'
  },
  domainName: process.env.DOMAIN_NAME,
  hostedZoneId: process.env.HOSTED_ZONE_ID,
  certificateArn: process.env.CERTIFICATE_ARN,
});
```

Then deploy with:

```bash
export DOMAIN_NAME=fredjean.net
export HOSTED_ZONE_ID=Z1234567890ABC
export CERTIFICATE_ARN=arn:aws:acm:us-east-1:123456789012:certificate/...
cdk deploy
```
