const path = require('path')

module.exports = {
  url: 'https://google.com',

  defaultTimeout: 5e3,
  headless: false,
  keepOpenAfter: 10e3,

  steps: [
    {
      action: 'type',
      selector: 'input[aria-label="Search"]',
      text: 'foo',

      options: {
        delay: 200
      }
    },
    {
      action: 'click',
      selector: 'input[type="submit"]',

      wait: {
        for: 'navigation'
      }
    },
    {
      action: 'scrape',

      data: {
        result: {
          selector: 'div#rso > div',

          children: {
            link: {
              selector: 'a',
              attribute: 'href'
            },

            snippet: 'div[style="-webkit-line-clamp:2"]',
            title: 'h3'
          }
        }
      },

      path: path.resolve('./private/results.json')
    },
    {
      action: 'screenshot',

      options: {
        path: path.resolve('./private/screenshot.png')
      }
    }
  ]
}
