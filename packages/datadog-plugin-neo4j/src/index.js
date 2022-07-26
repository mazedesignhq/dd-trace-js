'use strict'

const Plugin = require('../../dd-trace/src/plugins/plugin')
const { storage } = require('../../datadog-core')
const analyticsSampler = require('../../dd-trace/src/analytics_sampler')

class Neo4jPlugin extends Plugin {
  static get name () {
    return 'neo4j'
  }

  constructor (...args) {
    super(...args)

    this.addSub('apm:neo4j:query:start', ({ attributes, statement }) => {
      const store = storage.getStore()
      const childOf = store ? store.span : store
      const span = this.tracer.startSpan('neo4j.query', {
        childOf,
        tags: {
          'db.name': attributes.dbName,
          'db.type': 'neo4j',
          'db.user': attributes.dbUser,
          'out.host': attributes.host,
          'out.port': attributes.port,
          'resource.name': statement,
          'service.name': this.config.service || `${this.tracer._service}-neo4j`,
          'span.kind': 'client',
          'span.type': 'cypher'
        }
      })
      analyticsSampler.sample(span, this.config.measured)
      this.enter(span, store)
    })

    this.addSub('apm:neo4j:query:error', err => {
      const span = storage.getStore().span
      span.setTag('error', err)
    })

    this.addSub('apm:neo4j:query:finish', () => {
      const span = storage.getStore().span
      span.finish()
    })
  }
}

module.exports = Neo4jPlugin
