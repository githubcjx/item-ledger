const app = getApp()
const store = require('../../utils/store')

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    menuRight: 96,
    cloudReady: true,
    loading: true,
    stats: { boxCount: 0, itemCount: 0, locationCount: 0 },
    recentBoxes: [],
    allBoxes: []
  },

  onLoad() {
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight,
      navBarHeight: app.globalData.navBarHeight,
      menuRight: app.globalData.menuRight,
      cloudReady: app.globalData.cloudReady
    })
  },

  onShow() {
    this.refresh()
  },

  async refresh() {
    if (!app.globalData.cloudReady) {
      this.setData({ cloudReady: false, loading: false })
      return
    }
    this.setData({ loading: true })
    try {
      const boxes = await store.getBoxes()
      const decorate = b => {
        const names = (b.items || []).map(i => i.name)
        return {
          boxId: b.boxId,
          name: b.name,
          coverPhoto: b.coverPhoto,
          locText: b.locationName || '未记录位置',
          chips: names.slice(0, 2),
          more: Math.max(0, names.length - 2),
          itemCount: names.length
        }
      }
      const all = boxes.map(decorate)
      this.setData({
        cloudReady: true,
        loading: false,
        stats: store.computeStats(boxes),
        recentBoxes: all.slice(0, 3),
        allBoxes: all
      })
    } catch (e) {
      console.error(e)
      this.setData({ loading: false })
      wx.showToast({ title: '加载失败，检查云环境/集合', icon: 'none' })
    }
  },

  goSearch() {
    wx.navigateTo({ url: '/pages/search/search' })
  },

  goNew() {
    wx.navigateTo({ url: '/pages/box-new/box-new' })
  },

  goDetail(e) {
    wx.navigateTo({ url: '/pages/box-detail/box-detail?id=' + e.currentTarget.dataset.id })
  },

  comingSoon() {
    wx.showToast({ title: '该功能在后续版本开放', icon: 'none' })
  }
})
