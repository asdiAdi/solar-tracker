import * as iam from "aws-cdk-lib/aws-iam";
import * as cdk from "aws-cdk-lib";
import { SolarTrackerBackendStack } from "./lib/solar-tracker-backend-stack.ts";
import { StaticSiteStack, GithubDeployStack } from "@asdi/aws-infra";

const app = new cdk.App();
const stage = process.env.STAGE ?? "dev";
if (!["dev", "prod"].includes(stage)) {
  throw new Error(`Invalid stage "${stage}"`);
}

const env = {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
};

const SSM_FRONTEND_PREFIX = `/solar-tracker/frontend/${stage}`;
const SSM_BACKEND_PREFIX = `/solar-tracker/backend/${stage}`;
const SSM_GITHUB_ACTION_PREFIX = `/solar-tracker/github-action/${stage}`;

const createSSMPolicy = (prefixes: string[]): iam.PolicyStatement => {
  return new iam.PolicyStatement({
    sid: "AllowGetParameter",
    actions: [
      "ssm:GetParameter",
      "ssm:GetParameters",
      "ssm:GetParametersByPath",
    ],
    resources: prefixes.flatMap((p) => [
      `arn:aws:ssm:${env.env.region}:${env.env.account}:parameter${p}`,
      `arn:aws:ssm:${env.env.region}:${env.env.account}:parameter${p}/*`,
    ]),
  });
};

const frontend = new StaticSiteStack(
  app,
  `SolarTrackerFrontendStack-${stage}`,
  {
    ...env,
    secondLevelDomain: "carladi.com",
    subDomain: stage === "prod" ? "solar" : `solar-${stage}`,
    spaFallback: true,
  },
);

const url = `https://${frontend.staticSite.domainName}`;
const allowedOrigins = [url];
if (stage !== "prod") {
  allowedOrigins.push("http://localhost:5173");
}

new SolarTrackerBackendStack(app, `SolarTrackerBackendStack-${stage}`, {
  ...env,
  stage,
  allowedOrigins: allowedOrigins,
  ssmPrefix: SSM_BACKEND_PREFIX,
  ssmPolicy: createSSMPolicy([SSM_BACKEND_PREFIX]),
});

// github actions
const deployment = new GithubDeployStack(
  app,
  `SolarTrackerGithubDeploymentStack-${stage}`,
  {
    ...env,
    roleName: `solar-tracker-github-deployment-${stage}`,
    github: {
      owner: "asdiAdi",
      ownerId: "80302904",
      repo: "solar-tracker",
      repoId: "1366971460",
      branch: stage === "prod" ? "main" : stage,
      environment: stage,
    },
    managedPolicies: [frontend.staticSite.managedPolicy],
    inlinePolicyStatements: [
      createSSMPolicy([SSM_FRONTEND_PREFIX, SSM_GITHUB_ACTION_PREFIX]),
    ],
  },
);

new cdk.CfnOutput(frontend, `SolarTrackerBucket-${stage}`, {
  value: frontend.staticSite.bucket.bucketName,
  description: "put to ssm parameter github-action: S3_BUCKET",
});
new cdk.CfnOutput(frontend, `SolarTrackerDistributionId-${stage}`, {
  value: frontend.staticSite.distribution.distributionId,
  description: "put to ssm parameter github-action: CLOUDFRONT_DISTRIBUTION_ID",
});
new cdk.CfnOutput(deployment, `SolarTrackerRoleToAssume-${stage}`, {
  value: deployment.role.roleArn,
  description: "github action variable: AWS_ROLE_TO_ASSUME",
});
new cdk.CfnOutput(deployment, `SolarTrackerRegion-${stage}`, {
  value: deployment.region,
  description: "github action variable: AWS_REGION",
});
