export default defineAppConfig({
  pages: [
    'pages/command/index',
    'pages/map/index',
    'pages/chronicle/index',
    'pages/treasury/index',
    'pages/affairs/index'
  ],
  subpackages: [
    {
      root: 'subpackages',
      pages: ['battle/index']
    }
  ],
  window: {
    backgroundTextStyle: 'dark',
    navigationBarBackgroundColor: '#30352f',
    navigationBarTitleText: '知域',
    navigationBarTextStyle: 'white',
    backgroundColor: '#d6c9aa'
  },
  tabBar: {
    color: '#aeb2a7',
    selectedColor: '#e1c98d',
    backgroundColor: '#30352f',
    borderStyle: 'black',
    list: [
      { pagePath: 'pages/command/index', text: '司令部' },
      { pagePath: 'pages/map/index', text: '地图' },
      { pagePath: 'pages/chronicle/index', text: '战史' },
      { pagePath: 'pages/treasury/index', text: '国库' },
      { pagePath: 'pages/affairs/index', text: '内务' }
    ]
  }
})
