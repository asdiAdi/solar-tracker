import * as cdk from 'aws-cdk-lib';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import * as dotenv from 'dotenv';
dotenv.config();

export class SolarTrackerBackendStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const fn = new lambda.Function(this, 'SolarDataFn', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('dist-lambda'), // built locally via `npm run bundle` (no Docker)
      memorySize: 256,
      timeout: cdk.Duration.seconds(20),
      logRetention: logs.RetentionDays.ONE_WEEK,
      environment: {
        SOLARMAN_BASE_URL: process.env.SOLARMAN_BASE_URL ?? 'https://globalapi.solarmanpv.com',
        SOLARMAN_TOKEN: process.env.SOLARMAN_TOKEN ?? '',
        DEVICE_SN: process.env.DEVICE_SN ?? '',
        GRID_PHP_PER_KWH: process.env.GRID_PHP_PER_KWH ?? '12',
      },
    });

    const api = new apigw.RestApi(this, 'SolarTrackerApi', {
      restApiName: 'solar-tracker-backend',
      defaultCorsPreflightOptions: { allowOrigins: apigw.Cors.ALL_ORIGINS, allowMethods: ['GET'] },
    });

    const key = api.addApiKey('SolarTrackerApiKey');
    const plan = api.addUsagePlan('SolarTrackerUsagePlan', { throttle: { rateLimit: 10, burstLimit: 20 } });
    plan.addApiStage({ stage: api.deploymentStage });
    plan.addApiKey(key);

    for (const p of ['live', 'day', 'month', 'year']) {
      api.root.addResource(p).addMethod('GET', new apigw.LambdaIntegration(fn), { apiKeyRequired: true });
    }

    new cdk.CfnOutput(this, 'ApiUrl', { value: api.url });
  }
}
