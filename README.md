# @d2l/koa-s3-sign-upload

Middleware for [Koa 2][] to sign AWS S3 upload requests, and designed to work with [react-s3-uploader][].

Credits [@OKNoah][] [@ktonon][].

Forked from https://github.com/ktonon/koa-s3-sign-upload

__Install__

```shell
$ npm install -S @d2l/koa-s3-sign-upload
```

__Usage__

```js
const signS3 = require('koa-s3-sign-upload');
const AWS = require('aws-sdk');

app.use(signS3({
  // required

  // S3 bucket to use
  bucket: 'MyS3Bucket',

  // S3 client
  S3: new AWS.S3(),

  // optional

  // Prepends this value to the object key. Default is no prefix.
  keyPrefix: 'prefix',

  // RegExp that the object key must match. Default is none.
  keyRegExp: /must-match-this-prefix\/.*/,

  // Callback function to validate signing requests, for example for more complex validation of the key. Default is none.
  validateRequest: callback(ctx, params),

  // Prepends a random GUID to the `objectName` query parameter.
  randomizeFilename: true,

  // Object ACL to set. Default 'private'.
  ACL: 'public',

  // Prefix for routes. Default is '/s3'
  prefix: '/v1/s3',

  // Adds a route that redirects to a signed download URL. Default is false.
  enableRedirect: true,

  // Sets the Expires header on the object. Default is 60.
  expires: 60
}));
```

With default parameters, this will expose an endpoint `GET /s3/sign` for signing S3 upload requests. The endpoint expects the following query parameters:

* Either `objectName` or `fileName`. If both are provided, `fileName` will be used. This is appended to the `keyPrefix` to form the S3 key. Note that the `randomizeFilename` option will cause the filename to get prepended with a GUID
* `contentType` will be used to set the mime type of the file once uploaded to S3
* `contentDistribution` can be one of `auto`, `inline` or `attachment`. This will result in the signed URL including a Content-Distribution header, the value of which is returned in the result. By default this header is not included, but it is strongly recommended to use this options to make your uploads more secure.

If `enableRedirect` is set, this will also provide another endpoint: `GET /s3/uploads/(.*)`, which will create a temporary URL that provides access to the uploaded file (which are uploaded privately by default). The request is then redirected to the URL, so that the image is served to the client.

__Response Format__

The response is designed for use by [react-s3-uploader][], but could be used for other clients.

Example response:

```json
{
  "filename": "filename.zip",
  "key": "some/path/filename.zip",
  "signedUrl": "https://signed-s3-put-object-url",
  "publicUrl": "https://signed-s3-get-object-url",
  "headers": {
    "Content-Disposition": "attachment; filename=\"filename.zip\"",
  }
}
```

__Access/Secret Keys__

The [aws-sdk][] must be configured with your account's AWS credentials. [There are a number of ways to provide these](http://docs.aws.amazon.com/AWSJavaScriptSDK/guide/node-configuring.html). The easiest ways are to either provide them in the options or to set up the `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` environment variables for the SDK to pick them up.

Note: Best practice in EC2/Lambda is to use an IAM instance/execution role, in which case you must not specify the `accessKeyId` and `secretAccessKey` options, and leave the `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` empty.


[@OKNoah]:https://github.com/OKNoah
[@ktonon]:https://github.com/ktonon
[aws-sdk]:https://github.com/aws/aws-sdk-js
[Koa 2]:http://koajs.com/
[react-s3-uploader]:https://github.com/odysseyscience/react-s3-uploader
