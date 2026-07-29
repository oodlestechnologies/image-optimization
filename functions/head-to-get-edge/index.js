'use strict';

// Lambda@Edge, Origin Request trigger.
// The image-processing origin is a Lambda Function URL, which cannot answer HEAD
// requests correctly (it strips the body but also zeroes Content-Length, no matter
// what the handler returns). Rewriting HEAD to GET here means the origin always
// executes and returns a full, correctly-sized response; CloudFront then applies its
// own standard HEAD handling (keep headers, drop body) when replying to the original
// HEAD request.
exports.handler = (event, context, callback) => {
    const request = event.Records[0].cf.request;
    if (request.method === 'HEAD') {
        request.method = 'GET';
    }
    callback(null, request);
};
