#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ImageOptimizationStack } from '../lib/image-optimization-stack';

const app = new cdk.App();

// EdgeFunction (used for the HEAD->GET Lambda@Edge fix) needs a concrete, resolved
// region to replicate to us-east-1, which requires an explicit env instead of leaving
// the stack environment-agnostic.
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION };

// Stage stacks
new ImageOptimizationStack(app, "ImgTransformationStackOodlesllc", { env });
new ImageOptimizationStack(app, "ImgTransformationStackPublic", { env });

// Prod stacks
new ImageOptimizationStack(app, "ImgTransformationStackOodlesllc-prod", { env });
new ImageOptimizationStack(app, "ImgTransformationStackPublic-prod", { env });

