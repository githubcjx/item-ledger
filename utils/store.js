/* ============================================================
   数据层 · 云开发版（云数据库 + 云存储）
   - 箱子数据存于云数据库集合 boxes（权限：仅创建者可读写）
   - 图片存于云存储，字段里保存 fileID，<image> 可直接渲染
   - 最近搜索 / 常用位置 等轻量数据仍放本地 storage
   接口均为 async，返回 Promise。
   ============================================================ */

const config = require('../config')

const RECENT_KEY = 'xd_recent_search'
const LOC_KEY = 'xd_locations'

function db() {
  return wx.cloud.database()
}
function coll() {
  return db().collection(config.boxesCollection)
}
function cmd() {
  return db().command
}

function uid(prefix) {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

function toMillis(v) {
  if (!v) return 0
  if (typeof v === 'number') return v
  if (v instanceof Date) return v.getTime()
  if (v.$date) return new Date(v.$date).getTime()
  const t = new Date(v).getTime()
  return isNaN(t) ? 0 : t
}

// 把云端文档规范化成页面使用的结构
function normalize(doc) {
  return {
    boxId: doc._id,
    name: doc.name || '未命名箱子',
    note: doc.note || '',
    coverPhoto: doc.coverPhoto || '',
    locationName: doc.locationName || '',
    locationPhoto: doc.locationPhoto || '',
    items: (doc.items || []).map(it => ({
      itemId: it.itemId || uid('item'),
      name: it.name,
      photo: it.photo || '',
      keywords: it.keywords || []
    })),
    createdAt: toMillis(doc.createdAt),
    updatedAt: toMillis(doc.updatedAt)
  }
}

/* ---------------- 箱子 CRUD ---------------- */

async function getBoxes() {
  // 云数据库单次最多取 20 条，这里分页拉全（个人数据量足够）
  const MAX = 20
  let all = []
  let skip = 0
  // 先拿一页判断是否还有更多
  /* eslint-disable no-constant-condition */
  while (true) {
    const res = await coll().orderBy('updatedAt', 'desc').skip(skip).limit(MAX).get()
    all = all.concat(res.data)
    if (res.data.length < MAX) break
    skip += MAX
    if (skip > 1000) break // 安全上限
  }
  return all.map(normalize)
}

async function getBox(boxId) {
  try {
    const res = await coll().doc(boxId).get()
    return res.data ? normalize(res.data) : null
  } catch (e) {
    return null
  }
}

async function addBox(draft) {
  const items = (draft.items || []).map(it => ({
    itemId: uid('item'),
    name: it.name,
    photo: it.photo || '',
    keywords: it.keywords || []
  }))
  const data = {
    name: draft.name || '未命名箱子',
    note: draft.note || '',
    coverPhoto: draft.coverPhoto || '',
    locationName: draft.locationName || '',
    locationPhoto: draft.locationPhoto || '',
    items,
    createdAt: db().serverDate(),
    updatedAt: db().serverDate()
  }
  rememberLocation(draft.locationName)
  const res = await coll().add({ data })
  return res._id
}

async function updateBox(boxId, patch) {
  const data = Object.assign({}, patch, { updatedAt: db().serverDate() })
  if (patch.locationName) rememberLocation(patch.locationName)
  await coll().doc(boxId).update({ data })
  return getBox(boxId)
}

async function deleteBox(boxId) {
  await coll().doc(boxId).remove()
}

async function addItemToBox(boxId, item) {
  const it = {
    itemId: uid('item'),
    name: item.name,
    photo: item.photo || '',
    keywords: item.keywords || []
  }
  await coll().doc(boxId).update({
    data: {
      items: cmd().push([it]),
      updatedAt: db().serverDate()
    }
  })
  return getBox(boxId)
}

// 修改某件物品（name / photo / keywords）
async function updateItemInBox(boxId, itemId, patch) {
  const box = await getBox(boxId)
  if (!box) return null
  const items = (box.items || []).map(it =>
    it.itemId === itemId ? Object.assign({}, it, patch) : it
  )
  return updateBox(boxId, { items })
}

// 删除某件物品
async function removeItemFromBox(boxId, itemId) {
  const box = await getBox(boxId)
  if (!box) return null
  const items = (box.items || []).filter(it => it.itemId !== itemId)
  return updateBox(boxId, { items })
}

/* ---------------- 统计 ---------------- */

function computeStats(boxes) {
  const itemCount = boxes.reduce((s, b) => s + (b.items ? b.items.length : 0), 0)
  const locSet = new Set(boxes.map(b => b.locationName).filter(Boolean))
  return { boxCount: boxes.length, itemCount, locationCount: locSet.size }
}

/* ---------------- 图片上传 ---------------- */

async function uploadImage(tempPath) {
  if (!tempPath) return ''
  if (tempPath.indexOf('cloud://') === 0) return tempPath // 已是云文件
  const m = tempPath.match(/\.(\w+)(\?|$)/)
  const ext = m ? m[1] : 'jpg'
  const cloudPath = 'images/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext
  const res = await wx.cloud.uploadFile({ cloudPath, filePath: tempPath })
  return res.fileID
}

/* ---------------- AI 物品识别（云函数调 Qwen-VL） ---------------- */

async function recognizeItems(fileID) {
  const res = await wx.cloud.callFunction({
    name: config.recognizeFn,
    data: { fileID }
  })
  return res.result // { ok, items, msg }
}

// v0.2 粗识别：返回 { ok, items:[{box:{x,y,w,h}, label}] }
async function detectItems(fileID) {
  const res = await wx.cloud.callFunction({
    name: config.detectFn,
    data: { fileID }
  })
  return res.result
}

// v0.2 细识别：对单个框命名，返回 { ok, name, keywords }
async function nameRegion(fileID, box) {
  const res = await wx.cloud.callFunction({
    name: config.nameFn,
    data: { fileID, box }
  })
  return res.result
}

/* ---------------- 常用位置 / 最近搜索（本地） ---------------- */

const DEFAULT_LOCATIONS = ['客厅储物柜', '阳台储物柜', '床底', '玄关鞋柜', '书桌抽屉']

function rememberLocation(name) {
  name = (name || '').trim()
  if (!name) return
  let list = (wx.getStorageSync(LOC_KEY) || []).filter(x => x !== name)
  list.unshift(name)
  wx.setStorageSync(LOC_KEY, list.slice(0, 12))
}

function getFrequentLocations() {
  const used = wx.getStorageSync(LOC_KEY) || []
  const merged = []
  used.concat(DEFAULT_LOCATIONS).forEach(name => {
    if (name && merged.indexOf(name) < 0) merged.push(name)
  })
  return merged.slice(0, 8)
}

function getRecentSearch() {
  return wx.getStorageSync(RECENT_KEY) || []
}

function pushRecentSearch(q) {
  q = (q || '').trim()
  if (!q) return
  let list = getRecentSearch().filter(x => x !== q)
  list.unshift(q)
  wx.setStorageSync(RECENT_KEY, list.slice(0, 8))
}

function removeRecentSearch(q) {
  const list = getRecentSearch().filter(x => x !== q)
  wx.setStorageSync(RECENT_KEY, list)
  return list
}

function clearRecentSearch() {
  wx.removeStorageSync(RECENT_KEY)
  return []
}

/* ---------------- 相对时间 ---------------- */

function relativeTime(ts) {
  ts = toMillis(ts)
  if (!ts) return '刚刚'
  const diff = Date.now() - ts
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return min + ' 分钟前'
  const hr = Math.floor(min / 60)
  if (hr < 24) return hr + ' 小时前'
  const day = Math.floor(hr / 24)
  if (day < 30) return day + ' 天前'
  const mon = Math.floor(day / 30)
  if (mon < 12) return mon + ' 个月前'
  return Math.floor(mon / 12) + ' 年前'
}

/* ---------------- 演示数据（可选，手动调用） ---------------- */

async function seedDemo() {
  const now = Date.now()
  const day = 86400000
  const seed = [
    { name: '换季衣物 · 冬装', note: '开春后记得拿出来晒一下', locationName: '阳台储物柜 · 第二层', items: [
      { name: '灰色毛衣', keywords: ['毛衣', '保暖', '上衣', '冬天'] },
      { name: '格纹围巾', keywords: ['围巾', '保暖', '冬天'] },
      { name: '毛线手套', keywords: ['手套', '保暖'] },
      { name: '羽绒服', keywords: ['羽绒服', '外套', '过冬', '保暖'] }
    ] },
    { name: '工具杂物箱', note: '', locationName: '玄关鞋柜底层', items: [
      { name: '电钻', keywords: ['电钻', '工具', '打孔'] },
      { name: '螺丝刀套装', keywords: ['螺丝刀', '工具', '维修'] }
    ] },
    { name: '数据线收纳盒', note: '', locationName: '书桌抽屉', items: [
      { name: '充电器 ×4', keywords: ['充电器', '数据线', '插头'] },
      { name: '充电宝', keywords: ['充电宝', '移动电源', '电池'] }
    ] }
  ]
  for (let i = 0; i < seed.length; i++) {
    const s = seed[i]
    await coll().add({ data: {
      name: s.name, note: s.note, coverPhoto: '', locationName: s.locationName, locationPhoto: '',
      items: s.items.map(it => ({ itemId: uid('item'), name: it.name, photo: '', keywords: it.keywords })),
      createdAt: new Date(now - (seed.length - i) * day),
      updatedAt: new Date(now - (seed.length - i) * day)
    } })
    rememberLocation(s.locationName)
  }
}

module.exports = {
  getBoxes,
  getBox,
  addBox,
  updateBox,
  deleteBox,
  addItemToBox,
  updateItemInBox,
  removeItemFromBox,
  computeStats,
  uploadImage,
  recognizeItems,
  detectItems,
  nameRegion,
  getFrequentLocations,
  getRecentSearch,
  pushRecentSearch,
  removeRecentSearch,
  clearRecentSearch,
  relativeTime,
  seedDemo
}
