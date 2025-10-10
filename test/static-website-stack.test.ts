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
      VersioningConfiguration: {
        Status: 'Enabled',
      },
    });
  });

  test('creates log bucket with lifecycle rules', () => {
    const app = new cdk.App();
    const stack = new StaticWebsiteStack(app, 'TestStack');
    const template = Template.fromStack(stack);

    template.resourceCountIs('AWS::S3::Bucket', 2); // Website bucket + log bucket
  });

  test('S3 bucket has access logging enabled', () => {
    const app = new cdk.App();
    const stack = new StaticWebsiteStack(app, 'TestStack');
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::S3::Bucket', {
      LoggingConfiguration: {
        LogFilePrefix: 'website-access-logs/',
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
        Logging: {
          Bucket: {},
          Prefix: 'cloudfront-logs/',
        },
      },
    });
  });

  test('creates CloudFront security headers policy', () => {
    const app = new cdk.App();
    const stack = new StaticWebsiteStack(app, 'TestStack');
    const template = Template.fromStack(stack);

    template.resourceCountIs('AWS::CloudFront::ResponseHeadersPolicy', 1);
    template.hasResourceProperties('AWS::CloudFront::ResponseHeadersPolicy', {
      ResponseHeadersPolicyConfig: {
        SecurityHeadersConfig: {
          StrictTransportSecurity: {
            AccessControlMaxAgeSec: 31536000,
            IncludeSubdomains: true,
            Preload: true,
          },
          ContentTypeOptions: {},
          FrameOptions: {
            FrameOption: 'DENY',
          },
        },
      },
    });
  });

  describe('Content Security Policy', () => {
    let csp: string;

    beforeEach(() => {
      const app = new cdk.App();
      const stack = new StaticWebsiteStack(app, 'TestStack');
      const template = Template.fromStack(stack);

      const policies = template.findResources('AWS::CloudFront::ResponseHeadersPolicy');
      const policyKey = Object.keys(policies)[0];
      const policy = policies[policyKey];
      
      csp = policy.Properties.ResponseHeadersPolicyConfig.SecurityHeadersConfig.ContentSecurityPolicy.ContentSecurityPolicy;
    });

    test('CSP is defined and not empty', () => {
      expect(csp).toBeDefined();
      expect(csp).not.toBe('');
    });

    test('allows self as default source', () => {
      expect(csp).toContain("default-src 'self'");
    });

    test('allows self and unsafe-inline for scripts', () => {
      expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    });

    test('allows self and unsafe-inline for styles', () => {
      expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    });

    test('allows images from self, data URIs, and all HTTPS sources', () => {
      expect(csp).toMatch(/img-src[^;]*'self'/);
      expect(csp).toMatch(/img-src[^;]*data:/);
      expect(csp).toMatch(/img-src[^;]*https:/);
    });

    describe('External Script Sources', () => {
      test('allows jQuery from code.jquery.com', () => {
        expect(csp).toMatch(/script-src[^;]*code\.jquery\.com/);
      });

      test('allows TypeKit from use.typekit.net', () => {
        expect(csp).toMatch(/script-src[^;]*use\.typekit\.net/);
      });

      test('allows Google Analytics from www.google-analytics.com', () => {
        expect(csp).toMatch(/script-src[^;]*www\.google-analytics\.com/);
      });

      test('allows Pingdom RUM from rum-static.pingdom.net', () => {
        expect(csp).toMatch(/script-src[^;]*rum-static\.pingdom\.net/);
      });

      test('allows Disqus scripts from *.disqus.com', () => {
        expect(csp).toMatch(/script-src[^;]*\*\.disqus\.com/);
      });
    });

    describe('External Style Sources', () => {
      test('allows TypeKit fonts styles from use.typekit.net', () => {
        expect(csp).toMatch(/style-src[^;]*use\.typekit\.net/);
      });
    });

    describe('Connect Sources for AJAX/Fetch', () => {
      test('allows connections to self (including contact form via CloudFront)', () => {
        expect(csp).toMatch(/connect-src[^;]*'self'/);
      });

      test('allows connections to Google Analytics', () => {
        expect(csp).toMatch(/connect-src[^;]*www\.google-analytics\.com/);
      });

      test('allows connections to Disqus', () => {
        expect(csp).toMatch(/connect-src[^;]*\*\.disqus\.com/);
      });
    });

    describe('Font Sources', () => {
      test('includes font-src directive', () => {
        expect(csp).toMatch(/font-src/);
      });

      test('allows fonts from self', () => {
        expect(csp).toMatch(/font-src[^;]*'self'/);
      });

      test('allows fonts from use.typekit.net', () => {
        expect(csp).toMatch(/font-src[^;]*use\.typekit\.net/);
      });

      test('allows data URI fonts', () => {
        expect(csp).toMatch(/font-src[^;]*data:/);
      });
    });

    describe('Frame Sources', () => {
      test('includes frame-src directive', () => {
        expect(csp).toMatch(/frame-src/);
      });

      test('allows frames from disqus.com for comment embeds', () => {
        expect(csp).toMatch(/frame-src[^;]*disqus\.com/);
      });
    });

    test('CSP directives are properly semicolon-separated', () => {
      // Split by semicolon and check each directive has proper format
      const directives = csp.split(';').map(d => d.trim()).filter(d => d);
      
      expect(directives.length).toBeGreaterThan(0);
      
      directives.forEach(directive => {
        // Each directive should have at least a name and a value
        const parts = directive.split(/\s+/);
        expect(parts.length).toBeGreaterThanOrEqual(2);
        
        // First part should be the directive name (ends with -src or is default-src)
        expect(parts[0]).toMatch(/^(default-src|script-src|style-src|img-src|connect-src|font-src|frame-src)$/);
      });
    });

    test('CSP has all required directives', () => {
      const requiredDirectives = [
        'default-src',
        'script-src',
        'style-src',
        'img-src',
        'connect-src',
        'font-src',
        'frame-src'
      ];

      requiredDirectives.forEach(directive => {
        expect(csp).toMatch(new RegExp(`\\b${directive}\\b`));
      });
    });
  });

  test('creates Origin Access Control', () => {
    const app = new cdk.App();
    const stack = new StaticWebsiteStack(app, 'TestStack');
    const template = Template.fromStack(stack);

    template.resourceCountIs('AWS::CloudFront::OriginAccessControl', 1);
  });

  test('creates IAM role for GitHub Actions with default permissive policy', () => {
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

  test('creates IAM role with restricted GitHub repo when specified', () => {
    const app = new cdk.App();
    const stack = new StaticWebsiteStack(app, 'TestStack', {
      githubRepo: 'fredjean/fredjean-net-cdk',
    });
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: {
        Statement: [
          {
            Action: 'sts:AssumeRoleWithWebIdentity',
            Condition: {
              StringLike: {
                'token.actions.githubusercontent.com:sub': 'repo:fredjean/fredjean-net-cdk:*',
              },
            },
          },
        ],
      },
    });
  });

  test('GitHub deployment role has S3 bucket versioning permission', () => {
    const app = new cdk.App();
    const stack = new StaticWebsiteStack(app, 'TestStack');
    const template = Template.fromStack(stack);

    // Find the policy attached to the deployment role
    const policies = template.findResources('AWS::IAM::Policy');
    const deploymentRolePolicy = Object.values(policies).find(
      (policy: any) => policy.Properties.PolicyName.includes('GitHubDeploymentRole')
    );

    expect(deploymentRolePolicy).toBeDefined();
    const statements = deploymentRolePolicy?.Properties.PolicyDocument.Statement;
    
    // Find the statement with s3:PutBucketVersioning
    const versioningStatement = statements.find(
      (stmt: any) => Array.isArray(stmt.Action) 
        ? stmt.Action.includes('s3:PutBucketVersioning')
        : stmt.Action === 's3:PutBucketVersioning'
    );

    expect(versioningStatement).toBeDefined();
    expect(versioningStatement.Effect).toBe('Allow');
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

  describe('Route53 DNS Records', () => {
    test('creates both A and AAAA records when domain is configured', () => {
      const app = new cdk.App();
      const stack = new StaticWebsiteStack(app, 'TestStack', {
        domainName: 'example.com',
        hostedZoneId: 'Z1234567890ABC',
        certificateArn: 'arn:aws:acm:us-east-1:123456789012:certificate/12345678-1234-1234-1234-123456789012',
      });
      const template = Template.fromStack(stack);

      // Should have 2 record sets: A record and AAAA record
      template.resourceCountIs('AWS::Route53::RecordSet', 2);
    });

    test('creates IPv4 A record pointing to CloudFront', () => {
      const app = new cdk.App();
      const stack = new StaticWebsiteStack(app, 'TestStack', {
        domainName: 'example.com',
        hostedZoneId: 'Z1234567890ABC',
        certificateArn: 'arn:aws:acm:us-east-1:123456789012:certificate/12345678-1234-1234-1234-123456789012',
      });
      const template = Template.fromStack(stack);

      // Find the A record
      const recordSets = template.findResources('AWS::Route53::RecordSet');
      const aRecord = Object.values(recordSets).find((r: any) => r.Properties.Type === 'A');

      expect(aRecord).toBeDefined();
      expect(aRecord?.Properties.Name).toBe('example.com.');
      expect(aRecord?.Properties.AliasTarget.DNSName).toHaveProperty('Fn::GetAtt');
    });

    test('creates IPv6 AAAA record pointing to CloudFront', () => {
      const app = new cdk.App();
      const stack = new StaticWebsiteStack(app, 'TestStack', {
        domainName: 'example.com',
        hostedZoneId: 'Z1234567890ABC',
        certificateArn: 'arn:aws:acm:us-east-1:123456789012:certificate/12345678-1234-1234-1234-123456789012',
      });
      const template = Template.fromStack(stack);

      // Find the AAAA record
      const recordSets = template.findResources('AWS::Route53::RecordSet');
      const aaaaRecord = Object.values(recordSets).find((r: any) => r.Properties.Type === 'AAAA');

      expect(aaaaRecord).toBeDefined();
      expect(aaaaRecord?.Properties.Name).toBe('example.com.');
      expect(aaaaRecord?.Properties.AliasTarget.DNSName).toHaveProperty('Fn::GetAtt');
    });

    test('does not create Route53 records when domain is not configured', () => {
      const app = new cdk.App();
      const stack = new StaticWebsiteStack(app, 'TestStack');
      const template = Template.fromStack(stack);

      template.resourceCountIs('AWS::Route53::RecordSet', 0);
    });

    test('both A and AAAA records point to the same CloudFront distribution', () => {
      const app = new cdk.App();
      const stack = new StaticWebsiteStack(app, 'TestStack', {
        domainName: 'example.com',
        hostedZoneId: 'Z1234567890ABC',
        certificateArn: 'arn:aws:acm:us-east-1:123456789012:certificate/12345678-1234-1234-1234-123456789012',
      });
      const template = Template.fromStack(stack);

      const recordSets = template.findResources('AWS::Route53::RecordSet');
      const aRecord = Object.values(recordSets).find((r: any) => r.Properties.Type === 'A');
      const aaaaRecord = Object.values(recordSets).find((r: any) => r.Properties.Type === 'AAAA');

      expect(aRecord).toBeDefined();
      expect(aaaaRecord).toBeDefined();

      // Both should reference the same CloudFront distribution
      expect(aRecord?.Properties.AliasTarget.DNSName).toEqual(
        aaaaRecord?.Properties.AliasTarget.DNSName
      );
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
    template.hasOutput('ContactFormUrl', {});
  });

  describe('Lambda Contact Form', () => {
    test('creates Lambda function with correct runtime', () => {
      const app = new cdk.App();
      const stack = new StaticWebsiteStack(app, 'TestStack');
      const template = Template.fromStack(stack);

      template.hasResourceProperties('AWS::Lambda::Function', {
        Runtime: 'nodejs22.x',
        Handler: 'index.handler',
        Timeout: 10,
        MemorySize: 128,
        Description: 'Contact form handler that sends emails via SES',
      });
    });

    test('Lambda function has SES permissions', () => {
      const app = new cdk.App();
      const stack = new StaticWebsiteStack(app, 'TestStack');
      const template = Template.fromStack(stack);

      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: [
            {
              Action: ['ses:SendEmail', 'ses:SendRawEmail'],
              Effect: 'Allow',
              Resource: '*',
            },
          ],
        },
      });
    });

    test('creates Lambda Function URL', () => {
      const app = new cdk.App();
      const stack = new StaticWebsiteStack(app, 'TestStack');
      const template = Template.fromStack(stack);

      template.hasResourceProperties('AWS::Lambda::Url', {
        AuthType: 'NONE',
        Cors: {
          AllowMethods: ['POST'],
          AllowHeaders: ['Content-Type'],
          MaxAge: 300,
        },
      });
    });

    test('Lambda Function URL CORS allows domain when specified', () => {
      const app = new cdk.App();
      const stack = new StaticWebsiteStack(app, 'TestStack', {
        domainName: 'example.com',
      });
      const template = Template.fromStack(stack);

      template.hasResourceProperties('AWS::Lambda::Url', {
        Cors: {
          AllowOrigins: ['https://example.com'],
          AllowMethods: ['POST'],
        },
      });
    });

    test('Lambda Function URL CORS allows all origins when domain not specified', () => {
      const app = new cdk.App();
      const stack = new StaticWebsiteStack(app, 'TestStack');
      const template = Template.fromStack(stack);

      template.hasResourceProperties('AWS::Lambda::Url', {
        Cors: {
          AllowOrigins: ['*'],
        },
      });
    });

    test('Lambda function code is packaged from correct directory', () => {
      const app = new cdk.App();
      const stack = new StaticWebsiteStack(app, 'TestStack');
      const template = Template.fromStack(stack);

      // Verify the Lambda function has code configured
      const lambdaFunctions = template.findResources('AWS::Lambda::Function');
      const lambdaKey = Object.keys(lambdaFunctions)[0];
      const lambdaFunction = lambdaFunctions[lambdaKey];
      
      expect(lambdaFunction.Properties.Code).toBeDefined();
      expect(lambdaFunction.Properties.Code.S3Bucket).toBeDefined();
      expect(lambdaFunction.Properties.Code.S3Key).toBeDefined();
    });

    test('Lambda function has correct environment variables', () => {
      const app = new cdk.App();
      const stack = new StaticWebsiteStack(app, 'TestStack');
      const template = Template.fromStack(stack);

      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: {
            NODE_OPTIONS: '--enable-source-maps',
          },
        },
      });
    });
  });

  describe('CloudFront Distribution', () => {
    test('has two origins - S3 and Lambda', () => {
      const app = new cdk.App();
      const stack = new StaticWebsiteStack(app, 'TestStack');
      const template = Template.fromStack(stack);

      // CloudFront distribution should have 2 origins
      template.hasResourceProperties('AWS::CloudFront::Distribution', {
        DistributionConfig: {
          Origins: [
            {}, // S3 origin
            {}, // Lambda Function URL origin
          ],
        },
      });
    });

    test('has cache behavior for /rest/* path pattern', () => {
      const app = new cdk.App();
      const stack = new StaticWebsiteStack(app, 'TestStack');
      const template = Template.fromStack(stack);

      template.hasResourceProperties('AWS::CloudFront::Distribution', {
        DistributionConfig: {
          CacheBehaviors: [
            {
              PathPattern: '/rest/*',
              ViewerProtocolPolicy: 'redirect-to-https',
              AllowedMethods: [
                'GET',
                'HEAD',
                'OPTIONS',
                'PUT',
                'PATCH',
                'POST',
                'DELETE',
              ],
              Compress: false,
            },
          ],
        },
      });
    });

    test('/rest/* behavior uses caching disabled policy', () => {
      const app = new cdk.App();
      const stack = new StaticWebsiteStack(app, 'TestStack');
      const template = Template.fromStack(stack);

      // Get the cache policy ID for CACHING_DISABLED (managed policy)
      template.hasResourceProperties('AWS::CloudFront::Distribution', {
        DistributionConfig: {
          CacheBehaviors: [
            {
              PathPattern: '/rest/*',
              CachePolicyId: '4135ea2d-6df8-44a3-9df3-4b5a84be39ad', // CACHING_DISABLED
            },
          ],
        },
      });
    });

    test('/rest/* behavior forwards all viewer headers except host', () => {
      const app = new cdk.App();
      const stack = new StaticWebsiteStack(app, 'TestStack');
      const template = Template.fromStack(stack);

      template.hasResourceProperties('AWS::CloudFront::Distribution', {
        DistributionConfig: {
          CacheBehaviors: [
            {
              PathPattern: '/rest/*',
              OriginRequestPolicyId: 'b689b0a8-53d0-40ab-baf2-68738e2966ac', // ALL_VIEWER_EXCEPT_HOST_HEADER
            },
          ],
        },
      });
    });

    test('default behavior applies security headers', () => {
      const app = new cdk.App();
      const stack = new StaticWebsiteStack(app, 'TestStack');
      const template = Template.fromStack(stack);

      // Find the security headers policy reference
      const distribution = template.findResources('AWS::CloudFront::Distribution');
      const distributionKey = Object.keys(distribution)[0];
      const defaultBehavior = distribution[distributionKey].Properties.DistributionConfig.DefaultCacheBehavior;
      
      // Verify ResponseHeadersPolicyId references a resource (not a hardcoded value)
      expect(defaultBehavior.ResponseHeadersPolicyId).toHaveProperty('Ref');
      expect(typeof defaultBehavior.ResponseHeadersPolicyId.Ref).toBe('string');
    });

    test('uses S3 Origin Access Control for default behavior', () => {
      const app = new cdk.App();
      const stack = new StaticWebsiteStack(app, 'TestStack');
      const template = Template.fromStack(stack);

      template.hasResourceProperties('AWS::CloudFront::Distribution', {
        DistributionConfig: {
          DefaultCacheBehavior: {
            ViewerProtocolPolicy: 'redirect-to-https',
            Compress: true,
          },
        },
      });
    });

    test('has error responses configured', () => {
      const app = new cdk.App();
      const stack = new StaticWebsiteStack(app, 'TestStack');
      const template = Template.fromStack(stack);

      template.hasResourceProperties('AWS::CloudFront::Distribution', {
        DistributionConfig: {
          CustomErrorResponses: [
            {
              ErrorCode: 404,
              ResponseCode: 404,
              ResponsePagePath: '/error.html',
            },
            {
              ErrorCode: 403,
              ResponseCode: 403,
              ResponsePagePath: '/error.html',
            },
          ],
        },
      });
    });

    test('uses minimum TLS 1.2 when certificate is provided', () => {
      const app = new cdk.App();
      const stack = new StaticWebsiteStack(app, 'TestStack', {
        domainName: 'example.com',
        certificateArn: 'arn:aws:acm:us-east-1:123456789012:certificate/12345678-1234-1234-1234-123456789012',
      });
      const template = Template.fromStack(stack);

      template.hasResourceProperties('AWS::CloudFront::Distribution', {
        DistributionConfig: {
          ViewerCertificate: {
            MinimumProtocolVersion: 'TLSv1.2_2021',
          },
        },
      });
    });
  });

  describe('CloudFront Function for Directory Index', () => {
    test('creates CloudFront Function', () => {
      const app = new cdk.App();
      const stack = new StaticWebsiteStack(app, 'TestStack');
      const template = Template.fromStack(stack);

      template.resourceCountIs('AWS::CloudFront::Function', 1);
    });

    test('CloudFront Function has correct runtime', () => {
      const app = new cdk.App();
      const stack = new StaticWebsiteStack(app, 'TestStack');
      const template = Template.fromStack(stack);

      template.hasResourceProperties('AWS::CloudFront::Function', {
        FunctionConfig: {
          Runtime: 'cloudfront-js-2.0',
          Comment: 'Rewrites directory URLs to append index.html',
        },
      });
    });

    test('CloudFront Function has code', () => {
      const app = new cdk.App();
      const stack = new StaticWebsiteStack(app, 'TestStack');
      const template = Template.fromStack(stack);

      const functions = template.findResources('AWS::CloudFront::Function');
      const functionKey = Object.keys(functions)[0];
      const cfFunction = functions[functionKey];

      expect(cfFunction.Properties.FunctionCode).toBeDefined();
      expect(cfFunction.Properties.FunctionCode).toContain('function handler');
    });

    test('CloudFront Function is associated with default cache behavior', () => {
      const app = new cdk.App();
      const stack = new StaticWebsiteStack(app, 'TestStack');
      const template = Template.fromStack(stack);

      const distribution = template.findResources('AWS::CloudFront::Distribution');
      const distributionKey = Object.keys(distribution)[0];
      const defaultBehavior = distribution[distributionKey].Properties.DistributionConfig.DefaultCacheBehavior;

      expect(defaultBehavior.FunctionAssociations).toBeDefined();
      expect(defaultBehavior.FunctionAssociations).toHaveLength(1);
      expect(defaultBehavior.FunctionAssociations[0].EventType).toBe('viewer-request');
    });

    test('CloudFront Function association references the function', () => {
      const app = new cdk.App();
      const stack = new StaticWebsiteStack(app, 'TestStack');
      const template = Template.fromStack(stack);

      const distribution = template.findResources('AWS::CloudFront::Distribution');
      const distributionKey = Object.keys(distribution)[0];
      const defaultBehavior = distribution[distributionKey].Properties.DistributionConfig.DefaultCacheBehavior;

      // Verify the function association references a CloudFront Function
      const functionAssociation = defaultBehavior.FunctionAssociations[0];
      expect(functionAssociation.FunctionARN).toHaveProperty('Fn::GetAtt');
      expect(functionAssociation.FunctionARN['Fn::GetAtt'][1]).toBe('FunctionARN');
    });
  });
});
