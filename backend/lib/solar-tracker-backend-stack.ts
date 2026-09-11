import * as cdk from "aws-cdk-lib";
import * as apigw from "aws-cdk-lib/aws-apigateway";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";
import * as dotenv from "dotenv";
dotenv.config();

export class SolarTrackerBackendStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // saved data
    const table = new dynamodb.TableV2(this, "SolarTrackerDb", {
      tableName: "SolarTrackerDb",
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      timeToLiveAttribute: "expiresAt",
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      deletionProtection: true,
    });

    // work
    const fn = new lambda.Function(this, "SolarDataFn", {
      runtime: lambda.Runtime.NODEJS_24_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset("dist-lambda"),
      memorySize: 256,
      timeout: cdk.Duration.seconds(20),
      logRetention: logs.RetentionDays.ONE_WEEK,
      environment: {
        SOLARMAN_BASE_URL:
          process.env.SOLARMAN_BASE_URL ?? "https://globalapi.solarmanpv.com",
        SOLARMAN_TOKEN: process.env.SOLARMAN_TOKEN ?? "",
        DEVICE_SN: process.env.DEVICE_SN ?? "",
        GRID_PHP_PER_KWH: process.env.GRID_PHP_PER_KWH ?? "12",
        TABLE_NAME: table.tableName,
        ALLOWED_ORIGIN: process.env.ALLOWED_ORIGIN ?? "",
        BYPASS_PASSWORD: process.env.BYPASS_PASSWORD ?? "",
      },
    });
    table.grantReadWriteData(fn);

    // access
    // TODO: add custom domain name
    const api = new apigw.RestApi(this, "SolarTrackerApi", {
      restApiName: "solar-tracker-backend",
      defaultCorsPreflightOptions: {
        allowOrigins: [(process.env.ALLOWED_ORIGIN ?? "").trim()],
        allowMethods: ["GET", "POST"],
        allowHeaders: ["Content-Type", "X-Api-Key"],
      },
    });

    const key = api.addApiKey("SolarTrackerApiKey");
    const plan = api.addUsagePlan("SolarTrackerUsagePlan", {
      throttle: { rateLimit: 10, burstLimit: 20 },
    });
    plan.addApiStage({ stage: api.deploymentStage });
    plan.addApiKey(key);

    for (const p of ["live", "day", "month", "year"]) {
      api.root
        .addResource(p)
        .addMethod("GET", new apigw.LambdaIntegration(fn), {
          apiKeyRequired: true,
        });
    }
    api.root
      .addResource("bypass-update")
      .addMethod("POST", new apigw.LambdaIntegration(fn), {
        apiKeyRequired: true,
      });

    new cdk.CfnOutput(this, "ApiUrl", { value: api.url });
    new cdk.CfnOutput(this, "TableName", { value: table.tableName });
  }
}
