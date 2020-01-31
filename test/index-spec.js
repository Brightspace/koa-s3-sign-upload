const sinon = require('sinon');
const should = require('should');

const factory = require('../');

describe('factory', () => {
  it('should throw if no options', () => {
    (function wrapper() {
      factory();
    }).should.throw();
  });

  it('should throw if no bucket', () => {
    (function wrapper() {
      factory({});
    }).should.throw('bucket is required');
  });

  it('should throw if no S3', () => {
    (function wrapper() {
      factory({
        bucket: 'my-bucket',
      });
    }).should.throw('S3 is required');
  });

  it('should return routes', () => {
    const middleware = factory({
      bucket: 'bucket',
      S3: {
        getSignedUrl: () => 'signed-url',
      },
    });
    middleware.should.be.a.Function();
  });
});

describe('with S3 error', () => {
  it('throws an error', async () => {
    const middleware = factory({
      bucket: 'bucket',
      validateRequest: () => true,
      S3: {
        getSignedUrl: (command, params, callback) => {
          callback(new Error('doh'));
        },
      },
      expires: 3600,
    });

    const ctx = {
      method: 'GET',
      path: '/s3/sign',
      query: {
        objectName: 'filename.zip',
        fileName: 'filename.zip',
        contentType: 'application/zip',
      },
    };

    await middleware(ctx).should.be.rejectedWith('doh');
  });
});

describe('with invalid inputs', () => {
  let middleware;

  before(() => {
    middleware = factory({
      bucket: 'bucket',
      validateRequest: () => true,
      S3: {
        getSignedUrl: () => 'signed-url',
      },
    });
  });

  it('requires either fileName or objectName', async () => {
    const throwStub = sinon.stub().throws();
    const ctx = {
      method: 'GET',
      path: '/s3/sign',
      throw: throwStub,
      query: {},
    };
    await middleware(ctx).should.be.rejected();
    throwStub.getCall(0).args[0].should.equal(400);
  });

  it('requires contentType', async () => {
    const throwStub = sinon.stub().throws();
    const ctx = {
      method: 'GET',
      path: '/s3/sign',
      throw: throwStub,
      query: {
        fileName: 'somefile.txt',
      },
    };
    await middleware(ctx).should.be.rejected();
    throwStub.getCall(0).args[0].should.equal(400);
  });

  [/some-pattern\/.*/, 'some-pattern\\/.*'].forEach((keyRegExp, index) =>
    it(`adds throws when key does not match keyRegExp (case ${index})`, async () => {
      const throwStub = sinon.stub().throws();
      const middleware = factory({
        bucket: 'bucket',
        S3: {
          getSignedUrl: (command, params, callback) => {
            callback(null, 'signed-url');
          }
        },
        keyRegExp,
      });

      const ctx = {
        method: 'GET',
        path: '/s3/sign',
        query: {
          fileName: 'somefile.txt',
          contentType: 'text/plain',
        },
        throw: throwStub,
      };

      await middleware(ctx).should.be.rejected();

      throwStub.getCall(0).args[0].should.equal(400);
    })
  );
});

describe('with valid inputs', () => {
  const testCases = [{
    description: 'defaults',
  }, {
    description: 'content disposition auto',
    query: {
      fileName: 'image.jpg',
      contentType: 'image/jpeg',
    },
    expectations: {
      key: 'image.jpg',
      filename: 'image.jpg',
      contentDisposition: 'inline; filename="image.jpg"',
      contentType: 'image/jpeg',
    }
  }, {
    description: 'content disposition attachment',
    query: {
      contentDisposition: 'attachment',
    },
    expectations: {
      contentDisposition: 'attachment; filename="filename.zip"',
    }
  }, {
    description: 'content disposition inline',
    query: {
      contentDisposition: 'inline',
    },
    expectations: {
      contentDisposition: 'inline; filename="filename.zip"',
    }
  }, {
    description: 'content disposition falsy',
    query: {
      contentDisposition: false,
    },
    expectations: {
      contentDisposition: false,
    }
  }, {
    description: 'objectName instead of fileName',
    query: {
      fileName: null,
      objectName: 'another.mp4',
      contentType: 'video/mp4',
    },
    expectations: {
      key: 'another.mp4',
      filename: 'another.mp4',
      contentType: 'video/mp4',
      contentDisposition: 'attachment; filename="another.mp4"'
    }
  }, {
    description: 'with keyRegExp validation',
    factoryOptions: {
      keyRegExp: /the-prefix\/.+/,
    },
    query: {
      fileName: 'the-prefix/filename.zip',
    },
    expectations: {
      key: 'the-prefix/filename.zip',
      filename: 'the-prefix/filename.zip',
    }
  }, {
    description: 'sets ACL',
    factoryOptions: {
      ACL: 'public',
    },
    expectations: {
      acl: 'public',
    },
  }];

  testCases.forEach(testCase => it(testCase.description, async () => {
    const validateRequest = sinon.stub().returns(true);
    const S3 = {
      getSignedUrl: (command, params, callback) => {
        callback(null, 'signed-url');
      }
    };

    const middleware = factory(Object.assign({
      bucket: 'bucket',
      validateRequest,
      S3,
    }, testCase.factoryOptions));

    const ctx = {
      method: 'GET',
      path: '/s3/sign',
      query: Object.assign({
        fileName: 'filename.zip',
        contentType: 'application/zip',
        contentDisposition: 'auto',
      }, testCase.query),
    };

    await middleware(ctx).should.be.fulfilled();

    const expectations = Object.assign({
      filename: 'filename.zip',
      key: 'filename.zip',
      signedUrl: 'signed-url',
      contentDisposition: 'attachment; filename="filename.zip"',
      expires: 60,
      contentType: 'application/zip',
      acl: 'private',
    }, testCase.expectations);

    ctx.body.filename.should.equal(expectations.filename);
    ctx.body.key.should.equal(expectations.key);
    ctx.body.signedUrl.should.equal('signed-url');

    if (expectations.contentDisposition) {
      ctx.body.headers['Content-Disposition'].should.equal(expectations.contentDisposition);
    } else {
      should(ctx.body.headers).be.undefined();
    }

    const expectedParams = {
      Bucket: 'bucket',
      Key: expectations.key,
      Expires: expectations.expires,
      ContentType: expectations.contentType,
      ACL: expectations.acl,
    };

    if (expectations.contentDisposition) {
      expectedParams.ContentDisposition = expectations.contentDisposition;
    }

    validateRequest.getCall(0).args[0].should.deepEqual(ctx);
    validateRequest.getCall(0).args[1].should.deepEqual(expectedParams);
  }));

  it('randomizes filename', async () => {
    const middleware = factory({
      bucket: 'bucket',
      S3: {
        getSignedUrl: (command, params, callback) => {
          callback(null, 'signed-url');
        }
      },
      randomizeFilename: true,
    });

    const ctx = {
      method: 'GET',
      path: '/s3/sign',
      query: {
        fileName: 'somefile.txt',
        contentType: 'text/plain',
      },
    };

    await middleware(ctx);

    ctx.body.filename.should.match(/.+_somefile.txt/);
    ctx.body.key.should.match(/.+_somefile.txt/);
    ctx.body.signedUrl.should.equal('signed-url');
  });

  ['my-prefix', 'my-prefix/'].forEach((keyPrefix) => it(`adds ${keyPrefix}`, async () => {
    const middleware = factory({
      bucket: 'bucket',
      S3: {
        getSignedUrl: (command, params, callback) => {
          callback(null, 'signed-url');
        }
      },
      keyPrefix,
    });

    const ctx = {
      method: 'GET',
      path: '/s3/sign',
      query: {
        fileName: 'somefile.txt',
        contentType: 'text/plain',
      },
    };

    await middleware(ctx);

    ctx.body.filename.should.equal('somefile.txt');
    ctx.body.key.should.equal('my-prefix/somefile.txt');
  }));
});

describe('failed validation', () => {
  it('should return 400', async () => {
    const validateRequest = (ctx) => {
      ctx.status = 400;
      throw new Error('failed validation');
    };

    const S3 = {
      getSignedUrl: (command, params, callback) => {
        callback(null, 'signed-url');
      }
    };

    const middleware = factory({
      bucket: 'bucket',
      S3,
      validateRequest,
    });

    const ctx = {
      method: 'GET',
      path: '/s3/sign',
      query: {
        fileName: 'filename.zip',
        contentType: 'application/zip',
        contentDisposition: 'auto',
      },
    };

    await middleware(ctx).should.be.rejected();
    ctx.status.should.equal(400);
  });
});

describe('with no validator', () => {
  it('should succeed', async () => {
    const S3 = {
      getSignedUrl: (command, params, callback) => {
        callback(null, 'signed-url');
      }
    };

    const middleware = factory({
      bucket: 'bucket',
      S3,
    });

    const ctx = {
      method: 'GET',
      path: '/s3/sign',
      query: {
        fileName: 'filename.zip',
        contentType: 'application/zip',
        contentDisposition: 'auto',
      },
    };

    await middleware(ctx).should.be.fulfilled();
  });
});

describe('with enableRedirect', () => {
  it('sign request should return publicUrl', async () => {
    const S3 = {
      getSignedUrl: (command, params, callback) => {
        callback(null, 'signed-url');
      }
    };

    const middleware = factory({
      bucket: 'bucket',
      S3,
      enableRedirect: true,
    });

    const ctx = {
      method: 'GET',
      path: '/s3/sign',
      query: {
        fileName: 'filename.zip',
        contentType: 'application/zip',
      },
    };

    await middleware(ctx).should.be.fulfilled();

    ctx.body.publicUrl.should.equal('/s3/uploads/filename.zip');
  });

  it('get request should redirect', async () => {
    const S3 = {
      getSignedUrl: (command, params, callback) => {
        callback(null, 'signed-url');
      }
    };

    const middleware = factory({
      bucket: 'bucket',
      S3,
      enableRedirect: true,
    });

    const redirect = sinon.stub();
    const ctx = {
      method: 'GET',
      path: '/s3/uploads/filename.zip',
      redirect,
    };

    await middleware(ctx).should.be.fulfilled();

    redirect.getCall(0).args[0].should.equal('signed-url');
  });
});
