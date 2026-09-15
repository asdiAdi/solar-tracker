import * as cdk from "aws-cdk-lib";
import * as apigw from "aws-cdk-lib/aws-apigateway";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as ssm from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";

interface SolarTrackerBackendStackProps extends cdk.StackProps {
  stage: string;
}

export class SolarTrackerBackendStack extends cdk.Stack {
  constructor(
    scope: Construct,
    id: string,
    props: SolarTrackerBackendStackProps,
  ) {
    super(scope, id, props);
    const isProd = props.stage === "prod";
    const SSM_PREFIX = `/solar-tracker/backend/${props.stage}`;
    // Same SSM key as runtime Lambda reads via GetParametersByPath.
    // Requires re-synth/re-deploy after changing SSM; runtime picks it up live.
    const allowedOrigins = ssm.StringParameter.valueFromLookup(
      this,
      `${SSM_PREFIX}/ALLOWED_ORIGINS`,
    ).split(",");

    // saved data
    const table = new dynamodb.TableV2(this, "SolarTrackerDb", {
      tableName: `SolarTrackerDb-${props.stage}`,
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      timeToLiveAttribute: "expiresAt",
      removalPolicy: isProd
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
      deletionProtection: isProd,
    });

    const logGroup = new logs.LogGroup(this, "SolarDataFnLogGroup", {
      logGroupName: `/aws/lambda/SolarDataFn-${props.stage}`,
      retention: isProd
        ? logs.RetentionDays.ONE_MONTH
        : logs.RetentionDays.ONE_WEEK,
      removalPolicy: isProd
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
    });

    // work
    const fn = new lambda.Function(this, "SolarDataFn", {
      functionName: `SolarDataFn-${props.stage}`,
      runtime: lambda.Runtime.NODEJS_24_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset("infra/dist-lambda"),
      memorySize: 256,
      timeout: cdk.Duration.seconds(20),
      logGroup: logGroup,
      environment: {
        STAGE: props.stage,
        SSM_PREFIX: SSM_PREFIX,
      },
    });
    table.grantReadWriteData(fn);

    // access
    const api = new apigw.RestApi(this, "SolarTrackerApi", {
      restApiName: `SolarTrackerApi-${props.stage}`,
      deployOptions: {
        stageName: props.stage,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: allowedOrigins,
        allowMethods: ["GET", "POST"],
        allowHeaders: ["Content-Type", "X-Api-Key"],
      },
    });

    const key = api.addApiKey("SolarTrackerApiKey", {
      apiKeyName: `SolarTrackerApiKey-${props.stage}`,
    });
    const plan = api.addUsagePlan("SolarTrackerUsagePlan", {
      name: `SolarTrackerUsagePlan-${props.stage}`,
      throttle: { rateLimit: 10, burstLimit: 20 },
      quota: isProd ? { limit: 100, period: apigw.Period.DAY } : undefined,
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
    api.root
      .addResource("rate-update")
      .addMethod("POST", new apigw.LambdaIntegration(fn), {
        apiKeyRequired: true,
      });

    new cdk.CfnOutput(this, `ApiUrl-${props.stage}`, { value: api.url });
    new cdk.CfnOutput(this, `TableName-${props.stage}`, {
      value: table.tableName,
    });
  }
}
