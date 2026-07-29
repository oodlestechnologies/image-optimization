# Video Thumbnail Indexing Fix — Runbook

**Repo:** `oodles-com/image-optimization`
**Branch:** `fix/head-request-content-length`
**Affected CDN:** `d3qiujntfovx35.cloudfront.net`
**Example thumbnail:** `/oodles-files/9bf72dde-76ca-46b9-8cfe-bc8530e0f85a.jpg`
**Affected page:** `oodles.com/video/crypto-token-development-`

Google Search Console is flagging video pages with **"Thumbnail could not be crawled due to hostload."** Three real bugs in the image-optimization CDN stack are fixed on the branch above. This runbook is written for a team without prior context on how this stack was originally deployed — start at Phase 0, don't skip the discovery steps.

## Context

`thumbnailUrl` is a **required** field in the VideoObject structured data Google uses for video indexing — not optional metadata. When Google can't reliably fetch it, the video can fail to index entirely, which is what's happening here. The cause traces to how thumbnails are served: a CloudFront distribution in front of a Lambda that resizes/converts images on the fly (the AWS `image-optimization` reference architecture). Three separate bugs in that stack combine to make the thumbnail host look unreliable to a crawler.

## What changed (3 bugs found and fixed)

Confirmed against the live CDN and cross-checked against the upstream `aws-samples/image-optimization` reference this stack was forked from.

### 1. HEAD requests return an empty, 0-length body
**Files:** `functions/head-to-get-edge/index.js`, `lib/image-optimization-stack.ts`

Lambda Function URLs strip the body for HEAD requests and reset `Content-Length` to 0 no matter what the handler returns — this can't be fixed inside the Lambda. A new Lambda@Edge function rewrites HEAD → GET at the Origin Request stage, so the origin always runs normally and CloudFront applies its own correct HEAD handling on the way back (keep headers, drop body).

### 2. Cache-Control silently wasn't being set
**File:** `functions/image-processing/index.mjs`

It was written as S3 object `Metadata`, which only becomes a harmless `x-amz-meta-cache-control` header. Switched to the real `CacheControl` field, which S3 actually honors on GET/HEAD.

### 3. Missing CloudFront → Lambda invoke permission
**File:** `lib/image-optimization-stack.ts`

OAC (SigV4) invocations of a Function URL are authorized against the function's own invoke permission, not just the URL's. The missing `lambda:InvokeFunction` grant could cause intermittent Access Denied → unnecessary origin failover.

### Also fixed: `bin/image-optimization.ts`
Both stacks now set an explicit `env`. The new Lambda@Edge function needs a concretely resolved region to replicate to us-east-1 — without this, `cdk deploy` fails outright the moment it hits that resource.

---

## Phase 0 — Find the AWS account and live resources

Nobody on the team deployed this stack originally, so start by locating it — don't assume which account, or which of the two defined stacks (`ImgTransformationStackOodlesllc`, `ImgTransformationStackPublic`), is live.

1. In the AWS Console, open **CloudFront** and find the distribution whose domain matches `d3qiujntfovx35.cloudfront.net`.
2. Open that distribution's **Origins** tab. Note the S3 bucket names (original + transformed images) and the Lambda Function URL it points to.
3. Go to **CloudFormation** in the same account. Find the stack whose resources match what you just found.
4. Record the **account ID**, **region**, and **distribution ID** from that stack. You'll need all three below.

> **If nobody has access:** that's a bigger blocker than this fix. Get IAM/SSO access to that account from whoever holds root/billing for oodles.com before continuing.

## Phase 1 — Confirm you can act on it

1. Confirm your IAM identity has permissions for: CloudFormation, Lambda, IAM (role/policy creation), S3, CloudFront, SSM Parameter Store. CDK creates IAM roles as part of the deploy, so this needs to be fairly broad.
2. Check CDK bootstrap status in **both** regions you'll need — the stack's home region, and **us-east-1** separately (required for the new Lambda@Edge function to replicate, and this stack may never have touched us-east-1 before):
   ```bash
   aws cloudformation describe-stacks --stack-name CDKToolkit --region <home-region>
   aws cloudformation describe-stacks --stack-name CDKToolkit --region us-east-1
   ```
3. If either command says the stack doesn't exist, bootstrap it:
   ```bash
   npx cdk bootstrap aws://<ACCOUNT_ID>/<home-region>
   npx cdk bootstrap aws://<ACCOUNT_ID>/us-east-1
   ```

## Phase 2 — Deploy

1. Clone and check out the fix branch:
   ```bash
   git clone https://github.com/oodles-com/image-optimization.git
   cd image-optimization
   git checkout fix/head-request-content-length
   npm install
   ```
2. Build the Sharp native binary **for Lambda's runtime**, not your laptop's:
   ```bash
   npm run prebuild
   # sanity check the platform actually installed:
   ls functions/image-processing/node_modules/sharp/
   ```
3. With credentials for the account/role from Phase 1 active, review before touching anything live:
   ```bash
   npx cdk diff <stack-name-from-phase-0>
   ```
4. **Read the diff.** The last deploy was a direct console edit by someone no longer on the team — `cdk diff` may show it reverting undocumented changes, not just adding this fix. If anything looks unrelated or unexpected, stop and get a second pair of eyes on it before deploying.
5. Deploy:
   ```bash
   npx cdk deploy <stack-name-from-phase-0>
   ```

> **Timing:** first-time Lambda@Edge association can take 15–30 minutes to fully propagate across edge locations. The stack will finish "deploying" in CloudFormation well before the fix is live everywhere.

## Phase 3 — Invalidate cache and verify

1. Clear stale bad responses (0-length HEAD bodies, missing Cache-Control) sitting at the edge:
   ```bash
   aws cloudfront create-invalidation \
     --distribution-id <ID-from-phase-0> \
     --paths "/oodles-files/*"
   ```
2. If feasible, also clear or let expire the affected objects in the **transformed-image** S3 bucket — old copies there still carry the broken metadata-only Cache-Control until overwritten.
3. Confirm GET and HEAD now agree, and caching headers are real:
   ```bash
   curl -sD - -o /dev/null https://d3qiujntfovx35.cloudfront.net/oodles-files/9bf72dde-76ca-46b9-8cfe-bc8530e0f85a.jpg
   curl -sI    https://d3qiujntfovx35.cloudfront.net/oodles-files/9bf72dde-76ca-46b9-8cfe-bc8530e0f85a.jpg
   ```
4. **Pass condition:** HEAD reports the *same* `Content-Length` as GET, with an empty body. GET includes a real `Cache-Control: max-age=…` header. Run it a few times — a stale edge cache can mask the fix on the first hit.

## Phase 4 — Re-request indexing

1. Only after Phase 3 passes: in Search Console, open **URL Inspection** on `oodles.com/video/crypto-token-development-`.
2. Request indexing.
3. Video re-evaluation is not instant — expect days, not hours, before the report clears.

## If something goes wrong

- Redeploy the previous state: `git checkout <previous-commit>`, then `npx cdk deploy <stack-name>` again, followed by another cache invalidation.
- **Know before you need it:** a Lambda@Edge function can't be deleted immediately after it's disassociated from a distribution — AWS requires waiting for all edge replicas to expire first, which can take up to an hour. Don't be alarmed if a rollback that removes the edge function appears to hang.

## Execution checklist

- [ ] Phase 0 — Distribution, stack name, account ID and region identified
- [ ] Phase 1 — IAM access confirmed, both regions bootstrapped
- [ ] Phase 2 — `cdk diff` reviewed and understood
- [ ] Phase 2 — `cdk deploy` completed
- [ ] Phase 3 — CloudFront invalidation run
- [ ] Phase 3 — HEAD/GET Content-Length match confirmed
- [ ] Phase 3 — Cache-Control header confirmed present
- [ ] Phase 4 — Reindexing requested in Search Console
