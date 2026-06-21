const app = getApp()
const store = require('../../utils/store')

Page({
  data: {
    statusBarHeight: 20,
    menuRight: 96,
    step: 1,
    done: false,
    submitting: false,
    recognizing: false,
    recognizeStatus: '',
    // —— v0.2 两步识别（仅 AI 自动画框，不支持手动框选） ——
    recogPhase: 'idle',   // 'idle' | 'review'
    recogPhoto: '',       // 常驻参照原图（云 fileID）
    boxes: [],            // [{key,x,y,w,h,name,keywords,naming}]
    selected: -1,
    draft: {
      coverPhoto: '',
      name: '',
      note: '',
      items: [],
      locationName: '',
      locationPhoto: ''
    },
    newItemName: '',
    newItemPhoto: '',
    frequentLocations: []
  },

  _itemKey: 0,
  _boxKey: 0,

  onLoad() {
    this.setData({
      statusBarHeight: app.globalData.statusBarHeight,
      menuRight: app.globalData.menuRight,
      frequentLocations: store.getFrequentLocations()
    })
  },

  onShareAppMessage() {
    return {
      title: '用物账本记录你的收纳，找东西不再翻箱倒柜',
      path: '/pages/index/index'
    }
  },

  /* ---------- 选图（保留本地临时路径，提交时再上传） ---------- */
  _choose(cb) {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['camera', 'album'],
      sizeType: ['compressed'],
      success: res => {
        const temp = res.tempFiles && res.tempFiles[0] && res.tempFiles[0].tempFilePath
        if (temp) cb(temp)
      }
    })
  },

  chooseCover() {
    this._choose(p => this.setData({ 'draft.coverPhoto': p }))
  },

  chooseItemPhoto() {
    this._choose(p => this.setData({ newItemPhoto: p }))
  },

  chooseLocationPhoto() {
    this._choose(p => this.setData({ 'draft.locationPhoto': p }))
  },

  /* ============================================================
     v0.2 两步识别：粗识别画框 → 点框细识别命名 → 确认编辑
     ============================================================ */

  // 第一步：拍照 → 粗识别画框 → 本地裁出每件物品的缩略图
  detectFlow() {
    if (!app.globalData.cloudReady) {
      wx.showToast({ title: '请先配置云开发环境', icon: 'none' })
      return
    }
    this._choose(async tempPath => {
      this.setData({ recognizing: true, recognizeStatus: '正在上传照片…' })
      try {
        const fileID = await store.uploadImage(tempPath)
        this.setData({ recognizeStatus: '正在识别物品位置…' })
        const result = await store.detectItems(fileID)
        if (!result || !result.ok) throw new Error((result && result.msg) || '识别失败')
        const boxes = (result.items || []).map(it => ({
          key: 'b' + (this._boxKey++),
          x: it.box.x, y: it.box.y, w: it.box.w, h: it.box.h,
          name: it.label || '',
          keywords: [],
          refined: false,   // 是否已做过细识别（取到关键词）；粗识别的 label 仅作占位
          naming: false,
          thumb: ''
        }))
        // 准备裁剪：原图自然尺寸 + 画布 + 预载原图（用本地路径，更快）
        this._recogLocal = tempPath
        await this._prepCrop(tempPath)
        if (boxes.length) this.setData({ recognizeStatus: '正在裁剪缩略图…' })
        for (let i = 0; i < boxes.length; i++) {
          boxes[i].thumb = await this._cropBox(boxes[i])
        }
        this.setData({ recogPhoto: fileID, boxes, recogPhase: 'review' })
        wx.showToast({
          title: boxes.length ? ('框出 ' + boxes.length + ' 处，点框命名') : '没框到物品，可手动添加或整箱打标签',
          icon: 'none'
        })
      } catch (e) {
        console.error(e)
        wx.showModal({
          title: '识别失败',
          content: (e && e.message) || '请检查云函数 detectItems 是否部署、API Key 是否配置',
          showCancel: false
        })
      } finally {
        this.setData({ recognizing: false, recognizeStatus: '' })
      }
    })
  },

  // 读取原图自然尺寸 + 拿到画布节点 + 预载原图对象（供裁剪复用）
  _prepCrop(localPath) {
    return new Promise(resolve => {
      wx.getImageInfo({
        src: localPath,
        success: async info => {
          this._natW = info.width
          this._natH = info.height
          this._cropSrc = info.path || localPath
          try {
            await this._ensureCanvas()
            if (this._canvas) {
              this._cropImg = this._canvas.createImage()
              this._cropImg.onload = () => resolve()
              this._cropImg.onerror = () => resolve() // 裁剪失败不阻断主流程
              this._cropImg.src = this._cropSrc
            } else {
              resolve()
            }
          } catch (e) { resolve() }
        },
        fail: () => resolve()
      })
    })
  },

  _ensureCanvas() {
    if (this._canvas) return Promise.resolve()
    return new Promise(resolve => {
      wx.createSelectorQuery().in(this).select('#cropper').fields({ node: true }).exec(res => {
        if (res && res[0] && res[0].node) this._canvas = res[0].node
        resolve()
      })
    })
  },

  // 按归一化坐标从原图裁出局部图，返回本地临时路径
  async _cropBox(box) {
    if (!this._canvas || !this._cropImg || !this._natW) return ''
    try {
      const W = this._natW, H = this._natH
      let sx = Math.round(box.x * W), sy = Math.round(box.y * H)
      let sw = Math.round(box.w * W), sh = Math.round(box.h * H)
      sx = Math.max(0, Math.min(sx, W - 1))
      sy = Math.max(0, Math.min(sy, H - 1))
      sw = Math.max(1, Math.min(sw, W - sx))
      sh = Math.max(1, Math.min(sh, H - sy))
      const canvas = this._canvas
      canvas.width = sw
      canvas.height = sh
      const ctx = canvas.getContext('2d')
      ctx.clearRect(0, 0, sw, sh)
      ctx.drawImage(this._cropImg, sx, sy, sw, sh, 0, 0, sw, sh)
      const r = await new Promise((resolve, reject) => {
        wx.canvasToTempFilePath({ canvas, destWidth: sw, destHeight: sh, success: resolve, fail: reject })
      })
      return r.tempFilePath || ''
    } catch (e) {
      return ''
    }
  },

  // 第二步：点框 → 命名（未命名则 AI 命名；已命名则编辑）
  tapBox(e) {
    const i = e.currentTarget.dataset.i
    const box = this.data.boxes[i]
    if (!box) return
    this.setData({ selected: i })
    if (box.refined) {
      this._editBoxName(i)
    } else {
      this._nameBox(i)
    }
  },

  async _nameBox(i) {
    const box = this.data.boxes[i]
    if (!box || box.naming) return
    this.setData({ ['boxes[' + i + '].naming']: true })
    try {
      const res = await store.nameRegion(this.data.recogPhoto, { x: box.x, y: box.y, w: box.w, h: box.h })
      if (res && res.ok && res.name) {
        this.setData({
          ['boxes[' + i + '].name']: res.name,
          ['boxes[' + i + '].keywords']: res.keywords || [],
          ['boxes[' + i + '].refined']: true
        })
      } else {
        wx.showToast({ title: (res && res.msg) || '没认出来，手动改名', icon: 'none' })
        this._editBoxName(i)
      }
    } catch (e) {
      wx.showToast({ title: '命名失败', icon: 'none' })
    } finally {
      this.setData({ ['boxes[' + i + '].naming']: false })
    }
  },

  // 名字识别错 → 直接编辑
  _editBoxName(i) {
    const box = this.data.boxes[i]
    wx.showModal({
      title: '修改物品名称',
      editable: true,
      placeholderText: '如 灰色毛衣',
      content: box.name || '',
      success: res => {
        if (res.confirm) {
          const name = (res.content || '').trim()
          this.setData({
            ['boxes[' + i + '].name']: name,
            ['boxes[' + i + '].refined']: true
          })
        }
      }
    })
  },

  // 多识别 / 框错 → 删除该框
  removeBox(e) {
    const i = e.currentTarget.dataset.i
    const boxes = this.data.boxes.slice()
    boxes.splice(i, 1)
    this.setData({ boxes })
  },

  // 下方列表点名字：未命名则 AI 命名，已命名则编辑（复用 tapBox）
  tapName(e) {
    this.tapBox(e)
  },

  // 列表点缩略图：更换该框的图片（重新选图，合并时上传）
  replaceBoxPhoto(e) {
    const i = e.currentTarget.dataset.i
    this._choose(p => this.setData({ ['boxes[' + i + '].thumb']: p }))
  },

  /* ---------- 已确认清单（idle 宫格）的逐项编辑 ---------- */
  editDraftName(e) {
    const i = e.currentTarget.dataset.i
    const cur = this.data.draft.items[i]
    if (!cur) return
    wx.showModal({
      title: '修改物品名称',
      editable: true,
      placeholderText: '如 灰色毛衣',
      content: cur.name || '',
      success: res => {
        const name = (res.content || '').trim()
        if (res.confirm && name) this.setData({ ['draft.items[' + i + '].name']: name })
      }
    })
  },

  replaceDraftPhoto(e) {
    const i = e.currentTarget.dataset.i
    this._choose(p => this.setData({ ['draft.items[' + i + '].photo']: p }))
  },

  // 确认：已命名的框并入物品清单（上传各自裁好的缩略图作为物品图片）
  async mergeBoxes() {
    if (this._merging) return
    const named = this.data.boxes.filter(b => b.name && b.name.trim())
    const unnamed = this.data.boxes.length - named.length
    if (named.length === 0) {
      wx.showToast({ title: unnamed > 0 ? '请先点框命名' : '还没有框', icon: 'none' })
      return
    }
    this._merging = true
    wx.showLoading({ title: '处理中', mask: true })
    try {
      const newItems = []
      for (const b of named) {
        const photo = b.thumb ? await store.uploadImage(b.thumb) : ''
        newItems.push({
          key: 'k' + (this._itemKey++),
          name: b.name.trim(),
          photo,
          keywords: b.keywords || []
        })
      }
      this.setData({
        'draft.items': this.data.draft.items.concat(newItems),
        boxes: [],
        recogPhase: 'idle',
        recogPhoto: ''
      })
      wx.hideLoading()
      wx.showToast({ title: '已加入 ' + newItems.length + ' 件', icon: 'none' })
      if (unnamed > 0) setTimeout(() => wx.showToast({ title: unnamed + ' 个未命名框已忽略', icon: 'none' }), 700)
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: '处理失败，请重试', icon: 'none' })
    } finally {
      this._merging = false
    }
  },

  exitReview() {
    this.setData({ recogPhase: 'idle', boxes: [], recogPhoto: '' })
  },

  // 兜底退路：整箱打一个粗标签（写成一条物品，复用搜索）
  wholeBoxTag() {
    wx.showModal({
      title: '整箱打个标签',
      editable: true,
      placeholderText: '如 换季衣物 / 杂物 / 过年用品',
      success: res => {
        const tag = (res.content || '').trim()
        if (res.confirm && tag) {
          const items = this.data.draft.items.concat([{
            key: 'k' + (this._itemKey++),
            name: tag,
            photo: '',
            keywords: [tag, '整箱']
          }])
          this.setData({ 'draft.items': items })
          wx.showToast({ title: '已记为整箱标签', icon: 'none' })
        }
      }
    })
  },

  /* ---------- 输入 ---------- */
  onNameInput(e) { this.setData({ 'draft.name': e.detail.value }) },
  onNoteInput(e) { this.setData({ 'draft.note': e.detail.value }) },
  onLocInput(e) { this.setData({ 'draft.locationName': e.detail.value }) },
  onItemNameInput(e) { this.setData({ newItemName: e.detail.value }) },

  pickFrequent(e) {
    this.setData({ 'draft.locationName': e.currentTarget.dataset.loc })
  },

  /* ---------- 物品增删 ---------- */
  addItem() {
    const name = (this.data.newItemName || '').trim()
    if (!name) {
      wx.showToast({ title: '先输入物品名称', icon: 'none' })
      return
    }
    const items = this.data.draft.items.concat([{
      key: 'k' + (this._itemKey++),
      name,
      photo: this.data.newItemPhoto || '',
      keywords: []
    }])
    this.setData({ 'draft.items': items, newItemName: '', newItemPhoto: '' })
  },

  removeItem(e) {
    const items = this.data.draft.items.slice()
    items.splice(e.currentTarget.dataset.i, 1)
    this.setData({ 'draft.items': items })
  },

  /* ---------- 流程控制 ---------- */
  next() {
    const step = this.data.step
    if (step === 2 && !this.data.draft.name.trim()) {
      wx.showToast({ title: '请给箱子起个名字', icon: 'none' })
      return
    }
    if (step < 4) this.setData({ step: step + 1 })
  },

  back() {
    // 识别复核态：先退回第 3 步的 idle 态，不直接退出页面
    if (this.data.step === 3 && this.data.recogPhase === 'review') {
      this.exitReview()
      return
    }
    if (this.data.step > 1) {
      this.setData({ step: this.data.step - 1 })
    } else {
      wx.navigateBack({ delta: 1 })
    }
  },

  async finish() {
    if (this.data.submitting) return
    if (!app.globalData.cloudReady) {
      wx.showToast({ title: '请先配置云开发环境', icon: 'none' })
      return
    }
    this.setData({ submitting: true })
    wx.showLoading({ title: '保存中', mask: true })
    const d = this.data.draft
    try {
      const coverPhoto = await store.uploadImage(d.coverPhoto)
      const locationPhoto = await store.uploadImage(d.locationPhoto)
      const items = []
      for (const it of d.items) {
        const photo = it.photo ? await store.uploadImage(it.photo) : ''
        items.push({ name: it.name, photo, keywords: it.keywords || [] })
      }
      await store.addBox({
        name: d.name.trim() || '未命名箱子',
        note: d.note.trim(),
        coverPhoto,
        items,
        locationName: d.locationName.trim(),
        locationPhoto
      })
      // 用上传后的封面/数量刷新成功页展示
      this.setData({
        'draft.coverPhoto': coverPhoto,
        done: true
      })
    } catch (e) {
      console.error(e)
      wx.showToast({ title: '保存失败，请重试', icon: 'none' })
    } finally {
      wx.hideLoading()
      this.setData({ submitting: false })
    }
  },

  goHome() {
    wx.reLaunch({ url: '/pages/index/index' })
  },

  again() {
    this._itemKey = 0
    this._boxKey = 0
    this.setData({
      step: 1,
      done: false,
      recogPhase: 'idle',
      recogPhoto: '',
      boxes: [],
      draft: { coverPhoto: '', name: '', note: '', items: [], locationName: '', locationPhoto: '' },
      newItemName: '',
      newItemPhoto: '',
      frequentLocations: store.getFrequentLocations()
    })
  }
})
