'use strict'

const agent = require('../../dd-trace/test/plugins/agent')

describe('Plugin', () => {
  let neo4j
  let tracer

  withVersions('neo4j', ['neo4j-driver'], (version, moduleName) => {
    const metaModule = require(`../../../versions/${moduleName}@${version}`)

    describe('neo4j', () => {
      beforeEach(async () => {
        tracer = await require('../../dd-trace')
      })

      describe('driver', () => {
        let driver

        before(() => {
          return agent.load('neo4j')
        })

        after(() => {
          return agent.close({ ritmReset: false })
        })

        beforeEach(async () => {
          neo4j = metaModule.get()

          driver = neo4j.driver('bolt://localhost:11011', neo4j.auth.basic('neo4j', 'test'), {
            disableLosslessIntegers: true
          })

          await driver.verifyConnectivity()
        })

        afterEach(async () => {
          await driver.session().run('MATCH (n) DETACH DELETE n')
          await driver.close()
        })

        describe('session', () => {
          let session

          beforeEach(() => {
            session = driver.session()
          })

          afterEach(async () => {
            await session.close()
          })

          it('should set the correct tags', async () => {
            const statement = 'CREATE (n:Person { name: $name }) RETURN n.name'

            const expectedTagsPromise = agent
              .use(traces => {
                const span = traces[0][0]

                expect(span).to.have.property('name', 'neo4j.query')
                expect(span).to.have.property('service', 'test-neo4j')
                expect(span).to.have.property('resource', statement)
                expect(span).to.have.property('type', 'cypher')
                expect(span.meta).to.have.property('span.kind', 'client')
                expect(span.meta).to.have.property('db.name', 'neo4j')
                expect(span.meta).to.have.property('db.type', 'neo4j')
                expect(span.meta).to.have.property('db.user', 'neo4j')
                expect(span.meta).to.have.property('out.host', 'localhost')
                expect(span.metrics).to.have.property('out.port', 11011)
              })

            await session.run(statement, { name: 'Alice' })

            await expectedTagsPromise
          })

          it('should propagate context', async () => {
            const expectedSpanPromise = agent
              .use(traces => {
                const span = traces[0][0]

                expect(span).to.include({
                  name: 'test-context',
                  service: 'test'
                })

                expect(span.parent_id).to.not.be.null
              })

            const span = tracer.startSpan('test-context')

            await tracer.scope().activate(span, async () => {
              await session.run('MATCH (n) return n LIMIT 1')
              await span.finish()
            })
            await expectedSpanPromise
          })

          it('should handle errors', async () => {
            let error

            const expectedSpanPromise = agent
              .use(traces => {
                const span = traces[0][0]

                expect(span.meta).to.have.property('error.type', error.name)
                expect(span.meta).to.have.property('error.msg', error.message)
                expect(span.meta).to.have.property('error.stack', error.stack)
              })

            try {
              await session.run('NOT_EXISTS_OPERATION')
            } catch (err) {
              error = err
            }

            await expectedSpanPromise
          })
        })
      })
    })
  })
})
