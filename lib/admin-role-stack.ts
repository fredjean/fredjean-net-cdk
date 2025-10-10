import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';

export class AdminRoleStack extends cdk.Stack {
  public readonly adminRole: iam.Role;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create a role that can be assumed by PowerUserAccess
    this.adminRole = new iam.Role(this, 'AssumableAdminRole', {
      assumedBy: new iam.CompositePrincipal(
        // Allow PowerUserAccess SSO role to assume this role
        new iam.ArnPrincipal(`arn:aws:iam::${this.account}:root`).withConditions({
          StringLike: {
            'aws:PrincipalArn': `arn:aws:iam::${this.account}:role/aws-reserved/sso.amazonaws.com/*/AWSReservedSSO_PowerUserAccess_*`,
          },
        })
      ),
      roleName: 'AssumableAdministrator',
      description: 'Administrator role assumable from PowerUserAccess SSO role',
      maxSessionDuration: cdk.Duration.hours(12),
    });

    // Attach the AdministratorAccess managed policy
    this.adminRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('AdministratorAccess')
    );

    // Output the role ARN
    new cdk.CfnOutput(this, 'AdminRoleArn', {
      value: this.adminRole.roleArn,
      description: 'ARN of the assumable admin role',
    });
  }
}
