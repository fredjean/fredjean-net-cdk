#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { StaticWebsiteStack } from '../lib/static-website-stack';

const app = new cdk.App();
new StaticWebsiteStack(app, 'FredjeanNetStack', {
  env: { 
    account: '374317007405',
    region: 'us-east-1'
  },
  domainName: 'fredjean.net',
  hostedZoneId: 'Z02134391O9J4AJZKAYN5',
  certificateArn: 'arn:aws:acm:us-east-1:374317007405:certificate/7e1fa454-f9e0-4a27-8a01-cca8549d786c',
  githubRepo: 'fredjean/fredjean.net',
});
