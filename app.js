const config = require('./config')

App({
  globalData: {
    statusBarHeight: 20,
    navBarHeight: 44,
    capsuleBottom: 0,
    menuRight: 96, // 右侧需为微信胶囊预留的宽度(px)，默认兜底值
    cloudReady: false
  },

  onLaunch() {
    // 计算自定义导航栏需要的安全区高度
    try {
      const win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
      const statusBarHeight = win.statusBarHeight || 20
      this.globalData.statusBarHeight = statusBarHeight

      let navBarHeight = 44
      if (wx.getMenuButtonBoundingClientRect) {
        const cap = wx.getMenuButtonBoundingClientRect()
        navBarHeight = (cap.top - statusBarHeight) * 2 + cap.height
        this.globalData.capsuleBottom = cap.bottom
        // 右侧操作按钮需避开胶囊：预留 = 屏宽 - 胶囊左边缘 + 间距
        const winWidth = win.windowWidth || win.screenWidth || 375
        this.globalData.menuRight = Math.ceil(winWidth - cap.left + 8)
      }
      this.globalData.navBarHeight = navBarHeight
    } catch (e) {
      // 使用默认值
    }

    // 初始化云开发
    if (!wx.cloud) {
      console.error('当前基础库不支持云开发，请使用 2.2.3 以上版本')
      return
    }
    if (!config.cloudEnv) {
      console.warn('[物账本] 未配置云开发环境 ID，请在 miniprogram/config.js 填写 cloudEnv')
      return
    }
    wx.cloud.init({
      env: config.cloudEnv,
      traceUser: true
    })
    this.globalData.cloudReady = true
  }
})
