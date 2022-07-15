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

    this.addSub('apm:neo4j:query:start', ({ attributes, query }) => {
      const store = storage.getStore()
      const childOf = store ? store.span : store
      const operation = query.trim().split(/\s+/)[0]
      const span = this.tracer.startSpan('neo4j.query', {
        childOf,
        tags: {
          'service.name': this.config.service || `${this.tracer._service}-neo4j`,
          'span.kind': 'client',
          'span.type': 'cypher',
          'db.type': 'neo4j',
          'db.user': attributes.user,
          'out.host': attributes.host,
          'out.port': attributes.port,
          'neo4j.operation': operation,
          'neo4j.statement': query
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
