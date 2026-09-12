import * as cdk from "aws-cdk-lib";
import * as dotenv from "dotenv";
import { SolarTrackerBackendStack } from "./lib/solar-tracker-backend-stack.ts";
import { StaticSiteStack } from "@asdi/aws-infra";
dotenv.config();

const app = new cdk.App();

//backend
new SolarTrackerBackendStack(app, "SolarTrackerBackendStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? "us-east-1",
  },
});

//frontend
new StaticSiteStack(app, "SolarTrackerFrontendStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT!,
    region: process.env.CDK_DEFAULT_REGION ?? "us-east-1",
  },
  staticSite: {
    secondLevelDomain: "carladi.com",
    subDomain: "solar",
    github: {
      owner: "asdiAdi",
      ownerId: "80302904",
      repo: "solar-tracker",
      repoId: "1366971460",
    },
    tableName: "gh_site_secrets",
  },
});
