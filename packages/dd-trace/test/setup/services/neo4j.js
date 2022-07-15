'use strict'

const neo4j = require('../../../../../versions/neo4j-driver').get()
const RetryOperation = require('../operation')

function waitForNeo4j () {
  return new Promise((resolve, reject) => {
    const operation = new RetryOperation('neo4j')

    operation.attempt(currentAttempt => {
      const driver = neo4j.driver('bolt://localhost:11011', neo4j.auth.basic('neo4j', 'test'))

      driver.verifyConnectivity().then(() => {
        driver.close()
        resolve()
      }).catch(err => {
        if (operation.retry(err)) return
        reject(err)
      })
    })
  })
}

module.exports = waitForNeo4j
