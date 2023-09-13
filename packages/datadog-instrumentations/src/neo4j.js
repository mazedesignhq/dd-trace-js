'use strict'

const {
  channel,
  addHook,
  AsyncResource
} = require('./helpers/instrument')
const shimmer = require('../../datadog-shimmer')

const startCh = channel('apm:neo4j:query:start')
const finishCh = channel('apm:neo4j:query:finish')
const errorCh = channel('apm:neo4j:query:error')

addHook(
  {
    name: 'neo4j-driver-core',
    file: 'lib/session.js',
    versions: ['>=4.3.0']
  },
  (exports) => {
    shimmer.wrap(exports.default.prototype, 'run', wrapRun)
    return exports
  }
)

addHook(
  {
    name: 'neo4j-driver-core',
    file: 'lib/transaction.js',
    versions: ['>=4.3.0']
  },
  (exports) => {
    shimmer.wrap(exports.default.prototype, 'run', wrapRun)
    return exports
  }
)

addHook(
  {
    name: 'neo4j-driver',
    file: 'lib/session.js',
    versions: ['>=4.0.0 <4.3.0']
  },
  (exports) => {
    shimmer.wrap(exports.default.prototype, 'run', wrapRun)
    return exports
  }
)

addHook(
  {
    name: 'neo4j-driver',
    file: 'lib/transaction.js',
    versions: ['>=4.0.0 <4.3.0']
  },
  (exports) => {
    shimmer.wrap(exports.default.prototype, 'run', wrapRun)
    return exports
  }
)

function wrapRun (run) {
  return function (statement) {
    if (!startCh.hasSubscribers) {
      return run.apply(this, arguments)
    }

    if (!statement) return run.apply(this, arguments)

    const asyncResource = new AsyncResource('bound-anonymous-fn')
    const attributes = getAttributesFromNeo4jSession(this)

    return asyncResource.runInAsyncScope(() => {
      startCh.publish({ attributes, statement })

      try {
        const promise = run.apply(this, arguments)
        if (promise && typeof promise.then === 'function') {
          const onResolve = asyncResource.bind(() => finish())
          const onReject = asyncResource.bind(e => finish(e))

          promise.then(onResolve, onReject)
        } else {
          finish()
        }
        return promise
      } catch (err) {
        err.stack // trigger getting the stack at the original throwing point
        errorCh.publish(err)

        throw err
      }
    })
  }
}

function finish (error) {
  if (error) {
    errorCh.publish(error)
  }
  finishCh.publish()
}

function getAttributesFromNeo4jSession (session) {
  const connectionHolder =
    (session._mode === 'WRITE' ? session._writeConnectionHolder : session._readConnectionHolder) ||
    session._connectionHolder ||
    {}
  const connectionProvider = connectionHolder._connectionProvider || {}

  // seedRouter is used when connecting to a url that starts with "neo4j", usually aura
  const address = connectionProvider._address || connectionProvider._seedRouter

  const attributes = {
    // "neo4j" is the default database name. When used, "session._database" is an empty string
    dbName: session._database ? session._database : 'neo4j'
  }
  if (address) {
    attributes.host = address._host
    attributes.port = address._port
  }

  // neo4j-driver <5.12.0
  const auth = connectionProvider._authToken || {}
  if (auth.principal) {
    attributes.dbUser = auth.principal
  }

  // neo4j-driver >=5.12.0
  const authProvider = connectionProvider._authenticationProvider || {}
  const authTokenManager = authProvider._authTokenManager || {}
  const authToken = authTokenManager._authToken || {}
  if (authToken.principal) {
    attributes.dbUser = authToken.principal
  }

  return attributes
}
