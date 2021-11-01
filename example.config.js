const path = require('path')

module.exports = {
  url: 'https://google.com',

  defaultTimeout: 5e3,
  headless: false,
  keepOpenAfter: 10e3,
  maxPages: 4,
  useStealthPlugin: false,

  steps: [
    {
      action: 'type',
      xpath: '//input[@aria-label="Search"]',
      text: 'foo',
      delay: 200
    },
    {
      action: 'click',
      selector: 'input[type="submit"]',
      waitFor: 'navigation'
    },
    {
      action: 'repeat',
      times: 5,

      subSteps: [
        {
          action: 'screenshot',
          path: path.resolve('./private/screenshots/screenshot-$i.png')
        },
        {
          action: 'scrape',

          data: {
            result: {
              selector: 'div#rso > div',

              children: {
                link: {
                  xpath: './/a',
                  attribute: 'href'
                },

                snippet: 'div[style="-webkit-line-clamp:2"]',
                title: 'h3'
              }
            }
          },

          path: path.resolve('./private/results/results-$i.json')
        },
        {
          action: 'crawl',
          selector: 'a',
          attribute: 'href',

          subSteps: [
            {
              action: 'scrape',

              data: {
                title: 'title'
              },

              path: path.resolve('./private/titles/titles-$i.json')
            }
          ]
        },
        {
          action: 'click',
          selector: 'a#pnnext',
          waitFor: 'navigation'
        }
      ]
    }
  ]
}
