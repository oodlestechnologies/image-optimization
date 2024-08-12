#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ImageOptimizationStack } from '../lib/image-optimization-stack';

const app = new cdk.App();

// ProfileA stack
new ImageOptimizationStack(app, "ImgTransformationStackOodlesllc", {});

// Dev stack
new ImageOptimizationStack(app, "ImgTransformationStackPublic", {});

