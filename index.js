#!/usr/bin/env node

'use strict'

const fs = require('fs')
const path = require('path')
const puppeteer = require('puppeteer')

/**
 * @param  {Page}   page
 * @param  {Object} details
 *
 * @return {Promise}
 */
const wait = (page, details) => {
  const options = details.options || {}
  const args = []

  let method = 'waitFor'

  switch (details.for) {
    case 'function': {
      args.push(
        details.function,
        options,
        ...(details.args || [])
      )

      method += 'Function'
      break
    }

    case 'navigation': {
      args.push(options)
      method += 'Navigation'
      break
    }

    case 'networkIdle': {
      args.push(options)
      method += 'NetworkIdle'
      break
    }

    case 'request': {
      args.push(details.urlOrPredicate, options)
      method += 'Request'
      break
    }

    case 'response': {
      args.push(details.urlOrPredicate, options)
      method += 'Response'
      break
    }

    case 'selector': {
      args.push(details.selector, options)
      method += 'Selector'
      break
    }

    case 'timeout': {
      args.push(details.timeout)
      method += 'Timeout'
      break
    }

    case 'xpath': {
      args.push(details.xpath, options)
      args.push('XPath')
    }
  }

  return page[method](...args)
}

/**
 * @param  {Page}   page
 * @param  {Object} step
 *
 * @return {Promise}
 */
const scrape = async (page, step) => {
  const entries = Object
    .entries(step.data)
    .map(([key, value]) => ({ elem: page, key, result: null, value }))

  const results = []

  let attribute
  let children
  let done
  let selector

  let { elem, key, result, value } = entries.shift()

  while (!done) {
    if (typeof value === 'string') {
      attribute = 'textContent'
      children = []
      selector = value
    } else {
      attribute = value.attribute || 'textContent'
      children = value.children || []
      selector = value.selector
    }

    const childEntries = Object.entries(children)

    if (childEntries.length) {
      const elems = await elem.$$(selector)

      elems.forEach((elem, i) => {
        let ref = result

        if (!ref) {
          ref = results[i] = results[i] || {}
        }

        ref = ref[key] = {}

        childEntries.forEach(([key, value]) => {
          entries.push({ elem, key, value, result: ref })
        })
      })
    } else {
      const values = await elem.$$eval(selector, (elems, attribute) => {
        return elems.map(elem => elem[attribute])
      }, attribute)

      values.forEach((value, i) => {
        if (!result) {
          result = results[i] = results[i] || {}
        }

        if (result[key] !== undefined) {
          result[key] = [].concat(result[key]).concat(value)
        } else {
          result[key] = value
        }
      })
    }

    if (entries.length) {
      ({ elem, key, result, value } = entries.shift())
    } else {
      done = true
    }
  }

  const contents = JSON.stringify(results, null, 2)

  fs.createWriteStream(step.path).write(contents)
}

/**
 * @param  {Object}           config
 * @param  {Number}           config.defaultNavigationTimeout
 * @param  {Number}           config.defaultTimeout
 * @param  {Boolean}          config.headless
 * @param  {(Boolean|Number)} config.keepOpenAfter
 * @param  {Object[]}         config.steps
 * @param  {String}           config.url
 *
 * @return {Promise}
 */
const browserAutomate = async config => {
  const browser = await puppeteer.launch({
    defaultViewport: null,
    headless: config.headless
  })

  const page = await browser.newPage()

  if (config.defaultNavigationTimeout) {
    page.setDefaultNavigationTimeout(config.defaultNavigationTimeout)
  }

  if (config.defaultTimeout) {
    page.setDefaultTimeout(config.defaultTimeout)
  }

  await page.goto(config.url)

  for (const step of config.steps) {
    const options = step.options || {}
    const promises = []
    const promise = promises.push.bind(promises)

    switch (step.action) {
      case 'click': {
        if (step.wait) {
          promise(wait(page, step.wait))
        }

        promise(page.$eval(step.selector, elem => elem.click()))
        break
      }

      case 'go': {
        const args = []

        let method

        switch (step.to) {
          case 'back':
          case 'forward': {
            method = 'go' + step[0].toUpperCase() + step.to.slice(1)
            break
          }

          default: {
            args.push(step.to)
            method = 'goto'
          }
        }

        args.push(options)
        promise(page[method(...args)])
        break
      }

      case 'scrape': {
        promise(scrape(page, step))
        break
      }

      case 'screenshot': {
        promise(page.screenshot(step.options))
        break
      }

      case 'type': {
        promise(page.type(step.selector, step.text, options))
        break
      }

      case 'wait': {
        promise(wait(page, step))
        break
      }
    }

    await Promise.all(promises)
  }

  if (Number.isInteger(config.keepOpenAfter) && config.keepOpenAfter > 0) {
    setTimeout(() => browser.close(), config.keepOpenAfter)
  } else if (!config.keepOpenAfter) {
    await browser.close()
  }
}

const main = async () => {
  let pathToConfig = process.argv[2]

  if (!pathToConfig) {
    throw new Error('Please specify config path')
  }

  pathToConfig = (path.isAbsolute(pathToConfig) ? '' : './') + pathToConfig

  let config

  try {
    config = require(pathToConfig)
  } catch {
    throw new Error('Failed to read config')
  }

  await browserAutomate(config)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
