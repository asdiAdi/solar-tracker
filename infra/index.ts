import * as cdk from "aws-cdk-lib";
import * as dotenv from "dotenv";
import { SolarTrackerBackendStack } from "./lib/solar-tracker-backend-stack.ts";
import { StaticSiteStack } from "@asdi/aws-infra";
dotenv.config();

const app = new cdk.App();
const stage = process.env.STAGE ?? "dev";
if (!["dev", "prod"].includes(stage)) {
  throw new Error(`Invalid stage "${stage}"`);
}

dotenv.config({ path: `.env.${stage}` });

//backend
new SolarTrackerBackendStack(app, `SolarTrackerBackendStack-${stage}`, {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? "us-east-1",
  },
  stage,
});

//frontend
new StaticSiteStack(app, `SolarTrackerFrontendStack-${stage}`, {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT!,
    region: process.env.CDK_DEFAULT_REGION ?? "us-east-1",
  },
  staticSite: {
    secondLevelDomain: "carladi.com",
    subDomain: stage === "prod" ? "solar" : `solar-${stage}`,
    github: {
      owner: "asdiAdi",
      ownerId: "80302904",
      repo: "solar-tracker",
      repoId: "1366971460",
      branch: stage === "prod" ? "main" : stage,
      environment: stage,
    },
    tableName: "gh_site_secrets",
  },
});
