import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as iam from 'aws-cdk-lib/aws-iam';

export interface StaticWebsiteStackProps extends cdk.StackProps {
  domainName?: string;
  hostedZoneId?: string;
  certificateArn?: string;
}

export class StaticWebsiteStack extends cdk.Stack {
  public readonly bucket: s3.Bucket;
  public readonly distribution: cloudfront.Distribution;
  public readonly deploymentRole: iam.Role;

  constructor(scope: Construct, id: string, props?: StaticWebsiteStackProps) {
    super(scope, id, props);

    // S3 bucket for static website content
    this.bucket = new s3.Bucket(this, 'WebsiteBucket', {
      bucketName: props?.domainName ? `${props.domainName}-website` : undefined,
      websiteIndexDocument: 'index.html',
      websiteErrorDocument: 'error.html',
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      autoDeleteObjects: false,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
    });

    // ACM Certificate (if provided)
    let certificate: acm.ICertificate | undefined;
    if (props?.certificateArn) {
      certificate = acm.Certificate.fromCertificateArn(
        this,
        'Certificate',
        props.certificateArn
      );
    }

    // CloudFront distribution
    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        compress: true,
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        {
          httpStatus: 404,
          responseHttpStatus: 404,
          responsePagePath: '/error.html',
          ttl: cdk.Duration.minutes(5),
        },
        {
          httpStatus: 403,
          responseHttpStatus: 403,
          responsePagePath: '/error.html',
          ttl: cdk.Duration.minutes(5),
        },
      ],
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      certificate: certificate,
      domainNames: certificate && props?.domainName ? [props.domainName] : undefined,
    });

    // Route53 record (if hosted zone is provided)
    if (props?.hostedZoneId && props?.domainName) {
      const hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
        hostedZoneId: props.hostedZoneId,
        zoneName: props.domainName,
      });

      new route53.ARecord(this, 'AliasRecord', {
        zone: hostedZone,
        recordName: props.domainName,
        target: route53.RecordTarget.fromAlias(
          new targets.CloudFrontTarget(this.distribution)
        ),
      });
    }

    // IAM role for GitHub Actions deployment
    this.deploymentRole = new iam.Role(this, 'GitHubDeploymentRole', {
      assumedBy: new iam.FederatedPrincipal(
        `arn:aws:iam::${this.account}:oidc-provider/token.actions.githubusercontent.com`,
        {
          StringEquals: {
            'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          },
          StringLike: {
            'token.actions.githubusercontent.com:sub': 'repo:*:*',
          },
        },
        'sts:AssumeRoleWithWebIdentity'
      ),
      description: 'Role for GitHub Actions to deploy static website',
      maxSessionDuration: cdk.Duration.hours(1),
    });

    // Grant deployment permissions
    this.bucket.grantReadWrite(this.deploymentRole);
    this.deploymentRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'cloudfront:CreateInvalidation',
          'cloudfront:GetInvalidation',
          'cloudfront:ListInvalidations',
        ],
        resources: [
          `arn:aws:cloudfront::${this.account}:distribution/${this.distribution.distributionId}`,
        ],
      })
    );

    // Outputs
    new cdk.CfnOutput(this, 'BucketName', {
      value: this.bucket.bucketName,
      description: 'S3 bucket name for website content',
    });

    new cdk.CfnOutput(this, 'DistributionId', {
      value: this.distribution.distributionId,
      description: 'CloudFront distribution ID',
    });

    new cdk.CfnOutput(this, 'DistributionDomainName', {
      value: this.distribution.distributionDomainName,
      description: 'CloudFront distribution domain name',
    });

    new cdk.CfnOutput(this, 'DeploymentRoleArn', {
      value: this.deploymentRole.roleArn,
      description: 'IAM role ARN for GitHub Actions deployment',
    });
  }
}
