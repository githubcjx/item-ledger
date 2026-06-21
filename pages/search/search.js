const app = getApp()
const store = require('../../utils/store')
const { searchInBoxes } = require('../../utils/search')

Page({
  data: {
    statusBarHeight: 20,
    autoFocus: true,
    query: '',
    searched: false,
    searching: false,
    results: [],
    recent: []
  },

  _boxes: null,

  onLoad() {
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight,
      recent: store.getRecentSearch()
    })
    this._preload()
  },

  async _preload() {
    if (!app.globalData.cloudReady) return
    try {
      this._boxes = await store.getBoxes()
    } catch (e) {
      this._boxes = []
    }
  },

  onInput(e) {
    this.setData({ query: e.detail.value, searched: false })
  },

  async doSearch() {
    const q = (this.data.query || '').trim()
    if (!q) {
      wx.showToast({ title: '输入点什么再搜', icon: 'none' })
      return
    }
    store.pushRecentSearch(q)
    this.setData({ searching: true })
    try {
      if (!this._boxes) this._boxes = await store.getBoxes()
      const raw = searchInBoxes(q, this._boxes)
      const results = raw.map((r, idx) => ({
        key: r.item.itemId + '_' + idx,
        boxId: r.box.boxId,
        boxName: r.box.name,
        locText: r.box.locationName || '未记录位置',
        itemName: r.item.name,
        itemPhoto: r.item.photo || ''
      }))
      this.setData({ searched: true, searching: false, results, recent: store.getRecentSearch() })
    } catch (e) {
      this.setData({ searching: false })
      wx.showToast({ title: '搜索失败', icon: 'none' })
    }
  },

  tapRecent(e) {
    this.setData({ query: e.currentTarget.dataset.q }, () => this.doSearch())
  },

  clear() {
    this.setData({ query: '', searched: false, results: [] })
  },

  goDetail(e) {
    wx.navigateTo({ url: '/pages/box-detail/box-detail?id=' + e.currentTarget.dataset.id })
  },

  back() {
    wx.navigateBack({ delta: 1 })
  }
})
