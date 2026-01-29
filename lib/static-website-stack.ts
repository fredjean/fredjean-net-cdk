import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as glue from 'aws-cdk-lib/aws-glue';
import * as athena from 'aws-cdk-lib/aws-athena';
import * as path from 'path';

export interface StaticWebsiteStackProps extends cdk.StackProps {
  domainName?: string;
  hostedZoneId?: string;
  certificateArn?: string;
  cdkGithubRepo?: string; // Repository for CDK deployments (e.g., 'fredjean/fredjean-net-cdk')
  websiteGithubRepo?: string; // Repository for website content deployments (e.g., 'fredjean/fredjean.net')
}

export class StaticWebsiteStack extends cdk.Stack {
  public readonly bucket: s3.Bucket;
  public readonly distribution: cloudfront.Distribution;
  public readonly websiteDeploymentRole: iam.Role;
  public readonly cdkDeploymentRole: iam.Role;
  public readonly logBucket: s3.Bucket;
  public readonly contactFormFunction: lambda.Function;
  public readonly blockedSubmissionsTable: dynamodb.Table;
  public readonly athenaResultsBucket: s3.Bucket;
  public readonly glueDatabase: glue.CfnDatabase;
  public readonly glueTable: glue.CfnTable;

  constructor(scope: Construct, id: string, props?: StaticWebsiteStackProps) {
    super(scope, id, props);

    // S3 bucket for access logs
    this.logBucket = new s3.Bucket(this, 'LogBucket', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      objectOwnership: s3.ObjectOwnership.OBJECT_WRITER,
      lifecycleRules: [
        {
          expiration: cdk.Duration.days(90),
        },
      ],
    });

    // S3 bucket for Athena query results
    this.athenaResultsBucket = new s3.Bucket(this, 'AthenaResultsBucket', {
      bucketName: props?.domainName ? `${props.domainName}-athena-results` : undefined,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          expiration: cdk.Duration.days(30),
        },
      ],
    });

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
      versioned: true,
      serverAccessLogsBucket: this.logBucket,
      serverAccessLogsPrefix: 'website-access-logs/',
      lifecycleRules: [
        {
          noncurrentVersionExpiration: cdk.Duration.days(30),
        },
      ],
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

    // DynamoDB table for blocked contact form submissions
    this.blockedSubmissionsTable = new dynamodb.Table(this, 'BlockedSubmissionsTable', {
      tableName: 'contact-form-blocked-submissions',
      partitionKey: { name: 'submissionId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      timeToLiveAttribute: 'ttl',
      pointInTimeRecovery: true,
    });

    // Lambda function for contact form (must be created before CloudFront distribution)
    this.contactFormFunction = new lambda.Function(this, 'ContactFormFunction', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/contact-form'), {
        exclude: ['*.test.mjs', 'coverage', 'README.md', 'README-old.md', 'vitest.config.*'],
      }),
      timeout: cdk.Duration.seconds(20),
      memorySize: 256,
      description: 'Contact form handler that sends emails via SES with spam detection',
      environment: {
        NODE_OPTIONS: '--enable-source-maps',
        TO_ADDRESS: 'Fred Jean <fred@fredjean.net>',
        FROM_ADDRESS: 'Contact Form <hello@fredjean.net>',
        ALLOWED_ORIGIN: props?.domainName ? `https://${props.domainName}` : '*',
        SPAM_DETECTION_ENABLED: 'true',
        SPAM_MODEL_ID: 'anthropic.claude-haiku-4-5-20251001-v1:0',
        SPAM_CONFIDENCE_THRESHOLD: '0.8',
        BLOCKED_SUBMISSIONS_TABLE: this.blockedSubmissionsTable.tableName,
      },
    });

    // Grant SES permissions to Lambda
    this.contactFormFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['ses:SendEmail', 'ses:SendRawEmail'],
        resources: ['*'],
      })
    );

    // Grant Bedrock permissions to Lambda
    this.contactFormFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['bedrock:InvokeModel'],
        resources: [
          `arn:aws:bedrock:${this.region}::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0`,
        ],
      })
    );

    // Grant DynamoDB permissions to Lambda
    this.blockedSubmissionsTable.grantWriteData(this.contactFormFunction);

    // Create Function URL for Lambda
    const functionUrl = this.contactFormFunction.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: props?.domainName ? [`https://${props.domainName}`] : ['*'],
        allowedMethods: [lambda.HttpMethod.POST],
        allowedHeaders: ['Content-Type'],
        maxAge: cdk.Duration.seconds(300),
      },
    });

    // Add explicit lambda:InvokeFunction permission for Function URL
    // Required as part of AWS's new authorization model (effective Nov 2026)
    // Function URLs now require both InvokeFunctionUrl and InvokeFunction permissions
    this.contactFormFunction.addPermission('InvokeFunctionPermission', {
      principal: new iam.AnyPrincipal(),
      action: 'lambda:InvokeFunction',
    });

    // Extract domain from Function URL (remove https:// and trailing /)
    const functionUrlDomain = cdk.Fn.select(2, cdk.Fn.split('/', functionUrl.url));

    // CloudFront Function for directory index rewriting
    const directoryIndexFunction = new cloudfront.Function(this, 'DirectoryIndexFunction', {
      code: cloudfront.FunctionCode.fromFile({
        filePath: path.join(__dirname, 'directory-index-rewrite.js'),
      }),
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      comment: 'Rewrites directory URLs to append index.html',
    });

    // CloudFront security headers policy
    const securityHeadersPolicy = new cloudfront.ResponseHeadersPolicy(
      this,
      'SecurityHeadersPolicy',
      {
        securityHeadersBehavior: {
          contentTypeOptions: { override: true },
          frameOptions: {
            frameOption: cloudfront.HeadersFrameOption.DENY,
            override: true,
          },
          referrerPolicy: {
            referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
            override: true,
          },
          strictTransportSecurity: {
            accessControlMaxAge: cdk.Duration.seconds(31536000),
            includeSubdomains: true,
            preload: true,
            override: true,
          },
          xssProtection: {
            protection: true,
            modeBlock: true,
            override: true,
          },
          contentSecurityPolicy: {
            contentSecurityPolicy: "default-src 'self'; img-src 'self' data: https:; script-src 'self' 'unsafe-inline' code.jquery.com use.typekit.net www.google-analytics.com rum-static.pingdom.net *.disqus.com; style-src 'self' 'unsafe-inline' use.typekit.net; connect-src 'self' www.google-analytics.com *.disqus.com; font-src 'self' use.typekit.net data:; frame-src disqus.com;",
            override: true,
          },
        },
      }
    );

    // CloudFront distribution
    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: securityHeadersPolicy,
        compress: true,
        functionAssociations: [
          {
            function: directoryIndexFunction,
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          },
        ],
      },
      additionalBehaviors: {
        '/rest/*': {
          origin: new origins.HttpOrigin(functionUrlDomain, {
            protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          compress: false,
        },
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
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      enableLogging: true,
      logBucket: this.logBucket,
      logFilePrefix: 'cloudfront-logs/',
      logIncludesCookies: false,
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

      new route53.AaaaRecord(this, 'AliasRecordIPv6', {
        zone: hostedZone,
        recordName: props.domainName,
        target: route53.RecordTarget.fromAlias(
          new targets.CloudFrontTarget(this.distribution)
        ),
      });
    }

    // IAM role for GitHub Actions website content deployment
    this.websiteDeploymentRole = new iam.Role(this, 'WebsiteDeploymentRole', {
      roleName: 'GitHubActions-WebsiteDeployment',
      assumedBy: new iam.FederatedPrincipal(
        `arn:aws:iam::${this.account}:oidc-provider/token.actions.githubusercontent.com`,
        {
          StringEquals: {
            'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          },
          StringLike: {
            'token.actions.githubusercontent.com:sub': props?.websiteGithubRepo
              ? `repo:${props.websiteGithubRepo}:*`
              : 'repo:fredjean/fredjean.net:*',
          },
        },
        'sts:AssumeRoleWithWebIdentity'
      ),
      description: 'Role for GitHub Actions to deploy static website content',
      maxSessionDuration: cdk.Duration.hours(1),
    });

    // Grant website deployment permissions
    this.bucket.grantReadWrite(this.websiteDeploymentRole);
    this.websiteDeploymentRole.addToPolicy(
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
    this.websiteDeploymentRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['s3:PutBucketVersioning'],
        resources: [this.bucket.bucketArn],
      })
    );

    // IAM role for GitHub Actions CDK infrastructure deployment
    this.cdkDeploymentRole = new iam.Role(this, 'CdkDeploymentRole', {
      roleName: 'GitHubActions-CdkDeployment',
      assumedBy: new iam.FederatedPrincipal(
        `arn:aws:iam::${this.account}:oidc-provider/token.actions.githubusercontent.com`,
        {
          StringEquals: {
            'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          },
          StringLike: {
            'token.actions.githubusercontent.com:sub': props?.cdkGithubRepo
              ? `repo:${props.cdkGithubRepo}:*`
              : 'repo:fredjean/fredjean-net-cdk:*',
          },
        },
        'sts:AssumeRoleWithWebIdentity'
      ),
      description: 'Role for GitHub Actions to deploy CDK infrastructure',
      maxSessionDuration: cdk.Duration.hours(1),
    });

    // Grant CDK deployment permissions
    // Allow assuming CDK execution roles
    this.cdkDeploymentRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['sts:AssumeRole'],
        resources: [
          `arn:aws:iam::${this.account}:role/cdk-*`,
        ],
      })
    );

    // Allow CloudFormation operations on CDK stacks
    this.cdkDeploymentRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'cloudformation:DescribeStacks',
          'cloudformation:DescribeStackEvents',
          'cloudformation:DescribeChangeSet',
          'cloudformation:CreateChangeSet',
          'cloudformation:ExecuteChangeSet',
          'cloudformation:DeleteChangeSet',
          'cloudformation:GetTemplate',
        ],
        resources: [
          `arn:aws:cloudformation:${this.region}:${this.account}:stack/CDKToolkit/*`,
          `arn:aws:cloudformation:${this.region}:${this.account}:stack/${this.stackName}/*`,
        ],
      })
    );

    // Allow S3 operations on CDK staging bucket
    this.cdkDeploymentRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          's3:GetObject',
          's3:PutObject',
          's3:ListBucket',
        ],
        resources: [
          `arn:aws:s3:::cdk-*-assets-${this.account}-${this.region}`,
          `arn:aws:s3:::cdk-*-assets-${this.account}-${this.region}/*`,
        ],
      })
    );

    // Allow reading SSM parameters for CDK context
    this.cdkDeploymentRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['ssm:GetParameter'],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter/cdk-bootstrap/*`,
        ],
      })
    );

    // AWS Glue database for CloudFront logs
    this.glueDatabase = new glue.CfnDatabase(this, 'CloudFrontLogsDatabase', {
      catalogId: this.account,
      databaseInput: {
        name: 'cloudfront_logs',
        description: 'Database for CloudFront access logs analysis',
      },
    });

    // AWS Glue table for CloudFront access logs
    // Schema based on CloudFront standard log format
    // https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/AccessLogs.html
    this.glueTable = new glue.CfnTable(this, 'CloudFrontLogsTable', {
      catalogId: this.account,
      databaseName: this.glueDatabase.ref,
      tableInput: {
        name: 'access_logs',
        description: 'CloudFront access logs in standard format',
        tableType: 'EXTERNAL_TABLE',
        parameters: {
          'skip.header.line.count': '2', // CloudFront logs have 2 header lines
          'projection.enabled': 'false',
        },
        storageDescriptor: {
          columns: [
            { name: 'date', type: 'date', comment: 'Date of the request' },
            { name: 'time', type: 'string', comment: 'Time of the request (UTC)' },
            { name: 'x_edge_location', type: 'string', comment: 'Edge location that served the request' },
            { name: 'sc_bytes', type: 'bigint', comment: 'Total bytes sent to the client' },
            { name: 'c_ip', type: 'string', comment: 'IP address of the client' },
            { name: 'cs_method', type: 'string', comment: 'HTTP method' },
            { name: 'cs_host', type: 'string', comment: 'Domain name' },
            { name: 'cs_uri_stem', type: 'string', comment: 'URI stem (path)' },
            { name: 'sc_status', type: 'int', comment: 'HTTP status code' },
            { name: 'cs_referer', type: 'string', comment: 'Referer header' },
            { name: 'cs_user_agent', type: 'string', comment: 'User-Agent header' },
            { name: 'cs_uri_query', type: 'string', comment: 'Query string' },
            { name: 'cs_cookie', type: 'string', comment: 'Cookie header' },
            { name: 'x_edge_result_type', type: 'string', comment: 'Result type (Hit, Miss, Error, etc.)' },
            { name: 'x_edge_request_id', type: 'string', comment: 'Encrypted request ID' },
            { name: 'x_host_header', type: 'string', comment: 'Host header sent by viewer' },
            { name: 'cs_protocol', type: 'string', comment: 'Protocol (http, https, ws, wss)' },
            { name: 'cs_bytes', type: 'bigint', comment: 'Bytes sent by the client' },
            { name: 'time_taken', type: 'double', comment: 'Time taken in seconds' },
            { name: 'x_forwarded_for', type: 'string', comment: 'X-Forwarded-For header' },
            { name: 'ssl_protocol', type: 'string', comment: 'SSL/TLS protocol' },
            { name: 'ssl_cipher', type: 'string', comment: 'SSL/TLS cipher' },
            { name: 'x_edge_response_result_type', type: 'string', comment: 'Response result type' },
            { name: 'cs_protocol_version', type: 'string', comment: 'HTTP protocol version' },
            { name: 'fle_status', type: 'string', comment: 'Field-level encryption status' },
            { name: 'fle_encrypted_fields', type: 'int', comment: 'Number of encrypted fields' },
            { name: 'c_port', type: 'int', comment: 'Client port number' },
            { name: 'time_to_first_byte', type: 'double', comment: 'Time to first byte in seconds' },
            { name: 'x_edge_detailed_result_type', type: 'string', comment: 'Detailed result type' },
            { name: 'sc_content_type', type: 'string', comment: 'Content-Type header' },
            { name: 'sc_content_len', type: 'bigint', comment: 'Content-Length header' },
            { name: 'sc_range_start', type: 'bigint', comment: 'Range request start byte' },
            { name: 'sc_range_end', type: 'bigint', comment: 'Range request end byte' },
          ],
          location: `s3://${this.logBucket.bucketName}/cloudfront-logs/`,
          inputFormat: 'org.apache.hadoop.mapred.TextInputFormat',
          outputFormat: 'org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat',
          compressed: true,
          serdeInfo: {
            serializationLibrary: 'org.apache.hadoop.hive.serde2.lazy.LazySimpleSerDe',
            parameters: {
              'field.delim': '\t',
              'serialization.format': '\t',
            },
          },
        },
      },
    });

    // Configure Athena workgroup for CloudFront log analysis
    const athenaWorkgroup = new athena.CfnWorkGroup(this, 'AthenaWorkGroup', {
      name: 'cloudfront-logs',
      description: 'Workgroup for analyzing CloudFront access logs',
      workGroupConfiguration: {
        resultConfiguration: {
          outputLocation: `s3://${this.athenaResultsBucket.bucketName}/`,
          encryptionConfiguration: {
            encryptionOption: 'SSE_S3',
          },
        },
        engineVersion: {
          selectedEngineVersion: 'AUTO',
        },
        publishCloudWatchMetricsEnabled: true,
      },
      recursiveDeleteOption: true,
    });

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

    new cdk.CfnOutput(this, 'WebsiteDeploymentRoleArn', {
      value: this.websiteDeploymentRole.roleArn,
      description: 'IAM role ARN for GitHub Actions website content deployment',
    });

    new cdk.CfnOutput(this, 'CdkDeploymentRoleArn', {
      value: this.cdkDeploymentRole.roleArn,
      description: 'IAM role ARN for GitHub Actions CDK infrastructure deployment',
    });

    new cdk.CfnOutput(this, 'ContactFormUrl', {
      value: functionUrl.url,
      description: 'Contact form Lambda function URL',
    });

    new cdk.CfnOutput(this, 'AthenaQueryResultsBucket', {
      value: this.athenaResultsBucket.bucketName,
      description: 'S3 bucket for Athena query results',
    });

    new cdk.CfnOutput(this, 'GlueDatabaseName', {
      value: this.glueDatabase.ref,
      description: 'Glue database name for CloudFront logs',
    });

    new cdk.CfnOutput(this, 'GlueTableName', {
      value: 'access_logs',
      description: 'Glue table name for CloudFront access logs',
    });

    new cdk.CfnOutput(this, 'AthenaWorkgroup', {
      value: athenaWorkgroup.name,
      description: 'Athena workgroup name',
    });
  }
}
