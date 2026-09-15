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

const backend = new SolarTrackerBackendStack(
  app,
  `SolarTrackerBackendStack-${stage}`,
  {
    ...env,
    stage,
  },
);

const frontend = new StaticSiteStack(
  app,
  `SolarTrackerFrontendStack-${stage}`,
  {
    ...env,
    secondLevelDomain: "carladi.com",
    subDomain: stage === "prod" ? "solar" : `solar-${stage}`,
  },
);

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
  },
);

new cdk.CfnOutput(backend, `SolarTrackerApiUrl-${stage}`, {
  value: backend.api.url,
  description: "Frontend base api url",
});
new cdk.CfnOutput(frontend, `SolarTrackerRegion-${stage}`, {
  value: frontend.region,
  description: "github action variable: AWS_REGION",
});
new cdk.CfnOutput(frontend, `SolarTrackerBucket-${stage}`, {
  value: frontend.staticSite.bucket.bucketName,
  description: "github action variable: S3_BUCKET",
});
new cdk.CfnOutput(frontend, `SolarTrackerDistributionId-${stage}`, {
  value: frontend.staticSite.distribution.distributionId,
  description: "github action variable: CLOUDFRONT_DISTRIBUTION_ID",
});
new cdk.CfnOutput(frontend, `SolarTrackerRoleToAssume-${stage}`, {
  value: deployment.role.roleArn,
  description: "github action variable: AWS_ROLE_TO_ASSUME",
});
