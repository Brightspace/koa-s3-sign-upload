const Router = require('koa-router');
const uuid = require('uuid');
const path = require('path');

module.exports = function S3Router(options) {
  if (!options.bucket) {
    throw new Error('bucket is required');
  }

  if (!options.S3 && !options.getSignedUrl) {
    throw new Error('S3 client or a custom getSignedUrl function is required');
  }

  // Promisifier for the getSignedUrl call
  const getSignedUrlAsync = options.getSignedUrl || ((command, params) => {
    return new Promise((resolve, reject) => {
      options.S3.getSignedUrl(command, params, (err, data) => {
        if (err) {
          reject(err);
        }
        resolve(data);
      });
    });
  });

  const router = new Router({
    prefix: options.prefix || '/s3'
  });

  if (options.enableRedirect) {
    /**
     * Redirects requests with a temporary signed URL, giving access
     * to GET an upload.
     */
    router.get('/uploads/:key', async function tempRedirect(ctx) {
      const params = {
        Bucket: options.bucket,
        Key: ctx.params.key,
      };
      ctx.redirect(await getSignedUrlAsync('getObject', params));
    });
  }

  /**
   * Returns an object with `signedUrl` and `publicUrl` properties that
   * give temporary access to PUT an object in an S3 bucket.
   */
  router.get('/sign', async function(ctx) {
    if (!ctx.query.objectName && !ctx.query.fileName) {
      ctx.throw(400, 'Either objectName or fileName is required as a query parameter');
    }
    if (!ctx.query.contentType) {
      ctx.throw(400, 'contentType is a required query parameter');
    }
    const self = ctx;
    let filename = ctx.query.fileName || ctx.query.objectName;
    if (options.randomizeFilename) {
      filename = `${uuid.v4()}_${filename}`;
    }
    const mimeType = ctx.query.contentType;

    const key = options.keyPrefix
      ? `${options.keyPrefix.replace(/\/$/, '')}/${filename}`
      : filename;

    if (options.keyRegExp) {
      const regexp = options.keyRegExp instanceof RegExp
        ? options.keyRegExp
        : new RegExp(options.keyRegExp);

        if (!regexp.test(key)) {
          ctx.throw(400, 'Key does not match the regexp');
        }
    }

    const params = {
      Bucket: options.bucket,
      Key: key,
      Expires: options.expires || 60,
      ContentType: mimeType,
      ACL: options.ACL || 'private',
    };

    const contentDisposition = ctx.query.contentDisposition;
    let contentDispositionHeader;
    if (contentDisposition) {
      let disposition = contentDisposition;
      if (contentDisposition === 'auto') {
        if (mimeType.substr(0, 6) === 'image/') {
          disposition = 'inline';
        } else {
          disposition = 'attachment';
        }
      }
      contentDispositionHeader = `${disposition}; filename="${path.basename(filename)}"`;
      params.ContentDisposition = contentDispositionHeader;
    }

    if (options.validateRequest) {
      options.validateRequest(ctx, params);
    }

    const url = await getSignedUrlAsync('putObject', params);
    self.body = {
      filename: filename,
      key: key,
      signedUrl: url,
    };

    if (contentDispositionHeader) {
      self.body.headers = {
        'Content-Disposition': contentDispositionHeader,
      };
    }

    if (options.enableRedirect) {
      self.body.publicUrl = `/s3/uploads/${filename}`;
    }
  });

  return router.routes();
}
