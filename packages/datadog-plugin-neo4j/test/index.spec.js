'use strict'

const agent = require('../../dd-trace/test/plugins/agent')
const { ERROR_MESSAGE, ERROR_STACK, ERROR_TYPE } = require('../../dd-trace/src/constants')

describe('Plugin', () => {
  withVersions('neo4j', ['neo4j-driver', 'neo4j-driver-core'], (version, moduleName) => {
    const metaModule = require(`../../../versions/${moduleName}@${version}`)

    describe('neo4j', () => {
      let driver
      let neo4j
      let tracer

      beforeEach(async () => {
        tracer = await require('../../dd-trace')

        await agent.load('neo4j')

        if (moduleName === 'neo4j-driver-core') {
          neo4j = proxyquire(`../../../versions/neo4j-driver@${version}`, {
            'neo4j-driver-core': metaModule.get()
          }).get()
        } else {
          neo4j = metaModule.get()
        }

        driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'test-password'), {
          disableLosslessIntegers: true
        })

        await driver.verifyConnectivity()
      })

      afterEach(async () => {
        await driver.close()
        await agent.close({ ritmReset: false })
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

              expect(span).to.include({
                name: 'neo4j.query',
                service: 'test-neo4j',
                resource: statement,
                type: 'cypher'
              })
              expect(span.meta).to.include({
                'span.kind': 'client',
                'db.name': 'neo4j',
                'db.type': 'neo4j',
                'db.user': 'neo4j',
                'out.host': 'localhost'
              })
              expect(span.metrics).to.have.property('out.port', 7687)
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

              expect(span.meta).to.have.property(ERROR_TYPE, error.name)
              expect(span.meta).to.have.property(ERROR_MESSAGE, error.message)
              expect(span.meta).to.have.property(ERROR_STACK, error.stack)
            })

          try {
            await session.run('NOT_EXISTS_OPERATION')
          } catch (err) {
            error = err
          }

          await expectedSpanPromise
        })
      })

      describe('transaction', () => {
        let session

        beforeEach(() => {
          session = driver.session()
        })

        afterEach(async () => {
          await session.close()
        })

        it('should set the correct tags', async () => {
          const statement = 'MATCH (m:Movie { name: $name }) RETURN m.name'

          const expectedTagsPromise = agent
            .use(traces => {
              const span = traces[0][0]

              expect(span).to.include({
                name: 'neo4j.query',
                service: 'test-neo4j',
                resource: statement,
                type: 'cypher'
              })
              expect(span.meta).to.include({
                'span.kind': 'client',
                'db.name': 'neo4j',
                'db.type': 'neo4j',
                'db.user': 'neo4j',
                'out.host': 'localhost'
              })
              expect(span.metrics).to.have.property('out.port', 7687)
            })

          const transaction = session.beginTransaction()
          await transaction.run(statement, { name: 'Alice in Wonderland' })
          await transaction.commit()

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
            const transaction = session.beginTransaction()
            await transaction.run('MATCH (n) return n LIMIT 1')
            await transaction.commit()
            await span.finish()
          })

          await expectedSpanPromise
        })

        it('should handle errors', async () => {
          let error

          const expectedSpanPromise = agent
            .use(traces => {
              const span = traces[0][0]

              expect(span.meta).to.have.property(ERROR_TYPE, error.name)
              expect(span.meta).to.have.property(ERROR_MESSAGE, error.message)
              expect(span.meta).to.have.property(ERROR_STACK, error.stack)
            })

          try {
            const transaction = session.beginTransaction()
            await transaction.run('NOT_EXISTS_OPERATION')
            await transaction.commit()
          } catch (err) {
            error = err
          }

          await expectedSpanPromise
        })
      })
    })
  })
})
