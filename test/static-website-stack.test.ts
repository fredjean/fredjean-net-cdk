import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { StaticWebsiteStack } from '../lib/static-website-stack';

describe('StaticWebsiteStack', () => {
  test('creates S3 bucket with correct configuration', () => {
    const app = new cdk.App();
    const stack = new StaticWebsiteStack(app, 'TestStack');
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::S3::Bucket', {
      WebsiteConfiguration: {
        IndexDocument: 'index.html',
        ErrorDocument: 'error.html',
      },
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });

  test('creates CloudFront distribution', () => {
    const app = new cdk.App();
    const stack = new StaticWebsiteStack(app, 'TestStack');
    const template = Template.fromStack(stack);

    template.resourceCountIs('AWS::CloudFront::Distribution', 1);
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: {
        DefaultRootObject: 'index.html',
        Enabled: true,
      },
    });
  });

  test('creates Origin Access Control', () => {
    const app = new cdk.App();
    const stack = new StaticWebsiteStack(app, 'TestStack');
    const template = Template.fromStack(stack);

    template.resourceCountIs('AWS::CloudFront::OriginAccessControl', 1);
  });

  test('creates IAM role for GitHub Actions', () => {
    const app = new cdk.App();
    const stack = new StaticWebsiteStack(app, 'TestStack');
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: {
        Statement: [
          {
            Action: 'sts:AssumeRoleWithWebIdentity',
            Effect: 'Allow',
            Principal: {
              Federated: {
                'Fn::Join': [
                  '',
                  [
                    'arn:aws:iam::',
                    { Ref: 'AWS::AccountId' },
                    ':oidc-provider/token.actions.githubusercontent.com',
                  ],
                ],
              },
            },
          },
        ],
      },
    });
  });

  test('creates stack with domain configuration', () => {
    const app = new cdk.App();
    const stack = new StaticWebsiteStack(app, 'TestStack', {
      domainName: 'example.com',
      hostedZoneId: 'Z1234567890ABC',
      certificateArn: 'arn:aws:acm:us-east-1:123456789012:certificate/12345678-1234-1234-1234-123456789012',
    });
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::Route53::RecordSet', {
      Type: 'A',
    });
  });

  test('exports correct outputs', () => {
    const app = new cdk.App();
    const stack = new StaticWebsiteStack(app, 'TestStack');
    const template = Template.fromStack(stack);

    template.hasOutput('BucketName', {});
    template.hasOutput('DistributionId', {});
    template.hasOutput('DistributionDomainName', {});
    template.hasOutput('DeploymentRoleArn', {});
  });
});
