const app = getApp()
const store = require('../../utils/store')

Page({
  data: {
    statusBarHeight: 20,
    menuRight: 96,
    boxId: '',
    box: null,
    updatedText: '',
    addModal: { show: false, name: '', photo: '' }
  },

  onLoad(options) {
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight,
      menuRight: app.globalData.menuRight,
      boxId: options.id || ''
    })
  },

  onShow() {
    this.refresh()
  },

  onShareAppMessage() {
    const box = this.data.box
    const title = box
      ? '「' + box.name + '」收纳了 ' + (box.items ? box.items.length : 0) + ' 件物品'
      : '物账本 · 看看这个箱子里有什么'
    const share = { title, path: '/pages/box-detail/box-detail?id=' + this.data.boxId }
    if (box && box.coverPhoto) share.imageUrl = box.coverPhoto
    return share
  },

  async refresh() {
    if (!app.globalData.cloudReady) {
      wx.showToast({ title: '请先配置云开发环境', icon: 'none' })
      return
    }
    try {
      const box = await store.getBox(this.data.boxId)
      if (!box) {
        wx.showToast({ title: '箱子不存在', icon: 'none' })
        setTimeout(() => wx.navigateBack(), 800)
        return
      }
      this.setData({ box, updatedText: store.relativeTime(box.updatedAt) })
    } catch (e) {
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  // 点封面：预览 / 更换
  tapCover() {
    const cover = this.data.box.coverPhoto
    const list = []
    if (cover) list.push('预览图片')
    list.push(cover ? '更换封面照' : '添加封面照')
    wx.showActionSheet({
      itemList: list,
      success: res => {
        const label = list[res.tapIndex]
        if (label === '预览图片') wx.previewImage({ urls: [cover], current: cover })
        else this._replaceBoxPhoto('coverPhoto', '封面照')
      }
    })
  },

  // 点位置条：改名 / 换位置照 / 预览位置照
  tapLocation() {
    const photo = this.data.box.locationPhoto
    const list = ['修改名称']
    list.push(photo ? '更换照片' : '添加照片')
    if (photo) list.push('预览照片')
    wx.showActionSheet({
      itemList: list,
      success: res => {
        const label = list[res.tapIndex]
        if (label === '修改名称') this._editLocationName()
        else if (label === '预览照片') wx.previewImage({ urls: [photo], current: photo })
        else this._replaceBoxPhoto('locationPhoto', '照片')
      }
    })
  },

  _editLocationName() {
    wx.showModal({
      title: '更新存放位置',
      editable: true,
      placeholderText: '例如：阳台储物柜 · 第二层',
      content: this.data.box.locationName || '',
      success: async res => {
        if (res.confirm) {
          await store.updateBox(this.data.boxId, { locationName: (res.content || '').trim() })
          await this.refresh()
          wx.showToast({ title: '位置已更新', icon: 'none' })
        }
      }
    })
  },

  // 通用：更换箱子级别的某张照片（封面 / 位置照）
  _replaceBoxPhoto(field, label) {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['camera', 'album'],
      sizeType: ['compressed'],
      success: async res => {
        const temp = res.tempFiles && res.tempFiles[0] && res.tempFiles[0].tempFilePath
        if (!temp) return
        wx.showLoading({ title: '上传中', mask: true })
        try {
          const fileID = await store.uploadImage(temp)
          await store.updateBox(this.data.boxId, { [field]: fileID })
          await this.refresh()
          wx.hideLoading()
          wx.showToast({ title: label + '已更新', icon: 'none' })
        } catch (e) {
          wx.hideLoading()
          wx.showToast({ title: '更新失败', icon: 'none' })
        }
      }
    })
  },

  // 打开「添加物品」面板（名称必填，图片可选）
  addItem() {
    this.setData({ addModal: { show: true, name: '', photo: '' } })
  },

  closeAddItem() {
    this.setData({ 'addModal.show': false })
  },

  onAddNameInput(e) {
    this.setData({ 'addModal.name': e.detail.value })
  },

  chooseAddPhoto() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['camera', 'album'],
      sizeType: ['compressed'],
      success: res => {
        const temp = res.tempFiles && res.tempFiles[0] && res.tempFiles[0].tempFilePath
        if (temp) this.setData({ 'addModal.photo': temp })
      }
    })
  },

  clearAddPhoto() {
    this.setData({ 'addModal.photo': '' })
  },

  async confirmAddItem() {
    const name = (this.data.addModal.name || '').trim()
    if (!name) {
      wx.showToast({ title: '请输入物品名称', icon: 'none' })
      return
    }
    if (this._adding) return
    this._adding = true
    wx.showLoading({ title: '添加中', mask: true })
    try {
      const localPhoto = this.data.addModal.photo
      const photo = localPhoto ? await store.uploadImage(localPhoto) : '' // 图片可选
      await store.addItemToBox(this.data.boxId, { name, photo, keywords: [] })
      this.setData({ addModal: { show: false, name: '', photo: '' } })
      await this.refresh()
      wx.hideLoading()
      wx.showToast({ title: '已添加', icon: 'none' })
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: '添加失败，请重试', icon: 'none' })
    } finally {
      this._adding = false
    }
  },

  // 点某件物品：预览 / 改名 / 换图 / 删除
  tapItem(e) {
    const { id, photo, name } = e.currentTarget.dataset
    const hasPhoto = !!photo
    const list = []
    if (hasPhoto) list.push('预览图片')
    list.push('修改名称')
    list.push(hasPhoto ? '更换图片' : '添加图片')
    list.push('删除物品')
    wx.showActionSheet({
      itemList: list,
      success: res => {
        const label = list[res.tapIndex]
        if (label === '预览图片') {
          wx.previewImage({ urls: [photo], current: photo })
        } else if (label === '修改名称') {
          this._renameItem(id, name)
        } else if (label === '更换图片' || label === '添加图片') {
          this._replaceItemPhoto(id)
        } else if (label === '删除物品') {
          this._deleteItem(id, name)
        }
      }
    })
  },

  _renameItem(itemId, curName) {
    wx.showModal({
      title: '修改物品名称',
      editable: true,
      placeholderText: '如 灰色毛衣',
      content: curName || '',
      success: async res => {
        const name = (res.content || '').trim()
        if (res.confirm && name) {
          await store.updateItemInBox(this.data.boxId, itemId, { name })
          await this.refresh()
          wx.showToast({ title: '已修改', icon: 'none' })
        }
      }
    })
  },

  _replaceItemPhoto(itemId) {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['camera', 'album'],
      sizeType: ['compressed'],
      success: async res => {
        const temp = res.tempFiles && res.tempFiles[0] && res.tempFiles[0].tempFilePath
        if (!temp) return
        wx.showLoading({ title: '上传中', mask: true })
        try {
          const fileID = await store.uploadImage(temp)
          await store.updateItemInBox(this.data.boxId, itemId, { photo: fileID })
          await this.refresh()
          wx.hideLoading()
          wx.showToast({ title: '已更换', icon: 'none' })
        } catch (e) {
          wx.hideLoading()
          wx.showToast({ title: '更换失败', icon: 'none' })
        }
      }
    })
  },

  _deleteItem(itemId, name) {
    wx.showModal({
      title: '删除物品',
      content: '确定删除「' + (name || '该物品') + '」吗？',
      confirmText: '删除',
      confirmColor: '#C56B38',
      success: async res => {
        if (res.confirm) {
          await store.removeItemFromBox(this.data.boxId, itemId)
          await this.refresh()
          wx.showToast({ title: '已删除', icon: 'none' })
        }
      }
    })
  },

  editBox() {
    wx.showActionSheet({
      itemList: ['重命名箱子', '编辑备注', '删除箱子'],
      success: res => {
        if (res.tapIndex === 0) this._rename()
        else if (res.tapIndex === 1) this._editNote()
        else if (res.tapIndex === 2) this._delete()
      }
    })
  },

  _rename() {
    wx.showModal({
      title: '重命名箱子',
      editable: true,
      content: this.data.box.name || '',
      success: async res => {
        const name = (res.content || '').trim()
        if (res.confirm && name) {
          await store.updateBox(this.data.boxId, { name })
          await this.refresh()
        }
      }
    })
  },

  _editNote() {
    wx.showModal({
      title: '编辑备注',
      editable: true,
      placeholderText: '例如：开春后记得拿出来晒一下',
      content: this.data.box.note || '',
      success: async res => {
        if (res.confirm) {
          await store.updateBox(this.data.boxId, { note: (res.content || '').trim() })
          await this.refresh()
        }
      }
    })
  },

  _delete() {
    wx.showModal({
      title: '删除箱子',
      content: '删除后「' + this.data.box.name + '」及箱内物品记录将无法恢复，确定删除吗？',
      confirmText: '删除',
      confirmColor: '#C56B38',
      success: async res => {
        if (res.confirm) {
          wx.showLoading({ title: '删除中', mask: true })
          try {
            await store.deleteBox(this.data.boxId)
            wx.hideLoading()
            wx.showToast({ title: '已删除', icon: 'none' })
            setTimeout(() => wx.navigateBack(), 500)
          } catch (e) {
            wx.hideLoading()
            wx.showToast({ title: '删除失败', icon: 'none' })
          }
        }
      }
    })
  },

  // 阻止点面板内部时冒泡到遮罩关闭
  noop() {},

  back() {
    wx.navigateBack({ delta: 1 })
  }
})
