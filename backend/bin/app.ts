#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import * as dotenv from 'dotenv';
dotenv.config();

import { SolarTrackerBackendStack } from '../lib/solar-tracker-backend-stack';

const app = new cdk.App();
new SolarTrackerBackendStack(app, 'SolarTrackerBackendStack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'us-east-1' },
});
