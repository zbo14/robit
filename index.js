#!/usr/bin/env node

'use strict'

const fs = require('fs')
const path = require('path')
const puppeteer = require('puppeteer')

/**
 * @typedef   {Object} Config
 *
 * @property  {Number}            defaultNavigationTimeout
 * @property  {Number}            defaultTimeout
 * @property  {Boolean}           headless
 * @property  {(Boolean|Number)}  keepOpenAfter
 * @property  {Step[]}            steps
 * @property  {String}            url
 */

/**
 * @typedef   {Object} Step
 *
 * @property  {String} action   - string indicating which action to perform.
 * @property  {Data}   data     - an object describing what data to scrape.
 * @property  {String} for      - condition to wait for before proceeding.
 * @property  {String} path     - the path of a file to write to.
 * @property  {String} selector - the CSS selector of the element(s) to target.
 * @property  {Step[]} subSteps - sub-steps to perform multiple times before proceeding.
 * @property  {String} text     - text to type into element.
 * @property  {Number} times    - number of times to repeat the `subSteps`.
 * @property  {String} to       - navigate 'back', 'forward', or to a URL.
 * @property  {Step}   wait     - a wait sub-step that must complete with this step.
 * @property  {String} waitFor  -
 * @property  {String} xpath    - xpath of the element(s) to target
 */

const capitalize = str => str[0].toUpperCase() + str.slice(1)
const replaceIndex = (str, i) => str.replace(/\$i/g, i)

/**
 * @param  {Page}  page
 * @param  {Step}  step
 *
 * @return {Promise}
 */
const wait = (page, step) => {
  const args = []

  let method = capitalize(step.for)

  switch (step.for) {
    case 'function': {
      const { args: funcArgs = [], function: func, ...opts } = step
      args.push(func, opts, ...funcArgs)
      break
    }

    case 'navigation': {
      args.push(step)
      break
    }

    case 'networkIdle': {
      args.push(step)
      break
    }

    case 'request':
    case 'response': {
      const { function: func, url, ...opts } = step
      args.push(func || url, opts)
      break
    }

    case 'selector': {
      const { selector, ...opts } = step
      args.push(selector, opts)
      break
    }

    case 'timeout': {
      args.push(step.timeout)
      break
    }

    case 'xpath': {
      const { xpath, ...opts } = step
      args.push(xpath, opts)
      method = 'XPath'
    }
  }

  return page['waitFor' + method](...args)
}

/**
 * @param  {Page}   page
 * @param  {Object} step
 * @param  {Number} [i]
 *
 * @return {Promise}
 */
const scrape = async (page, step, i) => {
  const entries = Object
    .entries(step.data)
    .map(([key, value]) => ({ elem: page, key, result: null, value }))

  const results = []

  let attribute
  let children
  let done
  let selector
  let xpath

  let { elem, key, result, value } = entries.shift()

  while (!done) {
    if (typeof value === 'string') {
      attribute = 'textContent'
      children = []
      selector = value
      xpath = null
    } else {
      attribute = value.attribute || 'textContent'
      children = value.children || []
      selector = value.selector
      xpath = value.xpath
    }

    const childEntries = Object.entries(children)

    if (childEntries.length) {
      const method = selector ? '$$' : '$x'
      const arg = selector || xpath
      const elems = await page[method](arg)

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
      let values = []

      if (selector) {
        values = await elem.$$eval(selector, (elems, attribute) => {
          return elems.map(elem => elem[attribute])
        }, attribute)
      } else if (xpath) {
        const elems = await elem.$x(xpath)

        const promises = elems.map(elem => {
          return elem.evaluate((node, attribute) => {
            return node[attribute]
          }, attribute)
        })

        values = await Promise.all(promises)
      }

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

  const filename = replaceIndex(step.path, i)
  const dirname = path.dirname(filename)
  const contents = JSON.stringify(results, null, 2)

  await fs.promises.mkdir(dirname, { recursive: true }).catch(() => {})
  await fs.promises.writeFile(filename, contents)
}

/**
 * @param  {Page}   page
 * @param  {Object} step
 * @param  {Number} [i = 0]
 *
 * @return {Promise}
 */
const handleStep = async (page, step, i = 0) => {
  switch (step.action) {
    case 'click': {
      const promises = []

      if (step.wait) {
        promises.push(wait(page, step.wait))
      } else if (step.waitFor) {
        promises.push(wait(page, { for: step.waitFor }))
      }

      if (step.selector) {
        promises.push(page.$eval(step.selector, elem => elem.click()))
      } else if (step.xpath) {
        promises.push(
          page
            .$x(step.xpath)
            .then(([elem]) => {
              return elem && elem.evaluate(node => node.click())
            })
        )
      }

      await Promise.all(promises)
      break
    }

    case 'go': {
      const args = []
      const { to, ...opts } = step

      let method = 'go'

      switch (to) {
        case 'back':
        case 'forward': {
          method += capitalize(to)
          break
        }

        default: {
          args.push(to)
          method += 'to'
        }
      }

      args.push(opts)
      await page[method(...args)]
      break
    }

    case 'repeat': {
      const iters = Math.abs(step.times) || 10

      for (let i = 1; i <= iters; i++) {
        for (const subStep of step.subSteps) {
          await handleStep(page, subStep, i)
        }
      }

      break
    }

    case 'scrape': {
      await scrape(page, step, i)
      break
    }

    case 'screenshot': {
      const filename = replaceIndex(step.path, i)
      const dirname = path.dirname(filename)

      await fs.promises.mkdir(dirname, { recursive: true }).catch(() => {})
      await page.screenshot({ ...step, path: filename })

      break
    }

    case 'type': {
      const { selector, text, xpath, ...opts } = step

      if (selector) {
        await page.type(selector, text, opts)
      } else if (xpath) {
        const [elem] = await page.$x(xpath)
        await elem.type(text, opts)
      }

      break
    }

    case 'wait': {
      await wait(page, step)
    }
  }
}

/**
 * @param  {Config} config
 *
 * @return {Promise}
 */
const automateBrowser = async config => {
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
    await handleStep(page, step)
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

  await automateBrowser(config)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
