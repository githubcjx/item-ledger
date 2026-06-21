/* ============================================================
   云函数 detectItems · 粗识别（数数 + 画框）
   入参：{ fileID }
   出参：{ ok, items:[{box:{x,y,w,h}, label}], msg }
   坐标均为归一化 0~1（相对图片宽高）。
   只负责「有几件、各自大概在哪」，不强求精确命名。
   ============================================================ */
const cloud = require('wx-server-sdk')
const https = require('https')
const conf = require('./config')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const PROMPT = [
  '你是收纳助手。请框出这张照片里所有摊开的独立物品的位置（用于家庭收纳记录）。',
  '要求：',
  '1. 只输出 JSON 数组，不要任何解释、不要 markdown 代码块。',
  '2. 每个元素格式：{"box":[x1,y1,x2,y2],"label":"粗略名称(可省略)"}。',
  '3. 坐标为归一化小数，范围 0~1：x1,y1 为左上角，x2,y2 为右下角，相对图片宽和高。',
  '4. 尽量数清件数、框住每件物品；最多 15 个。',
  '示例：[{"box":[0.10,0.20,0.35,0.60],"label":"毛衣"}]'
].join('\n')

async function loadConfig() {
  let apiKey = process.env.DASHSCOPE_API_KEY || ''
  let model = conf.model
  try {
    const res = await db.collection(conf.configCollection).doc(conf.configDocId).get()
    const data = res && res.data
    if (data) {
      if (!apiKey && data.apiKey) apiKey = data.apiKey
      if (data.model) model = data.model
    }
  } catch (e) { /* 走兜底 */ }
  if (!apiKey) apiKey = conf.apiKey || ''
  return { apiKey, model }
}

function extToMime(fileID) {
  const m = (fileID || '').toLowerCase().match(/\.(\w+)(\?|$)/)
  const ext = m ? m[1] : 'jpeg'
  if (ext === 'png') return 'image/png'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'bmp') return 'image/bmp'
  return 'image/jpeg'
}

function callQwen(apiKey, model, dataUri) {
  const payload = JSON.stringify({
    model: model,
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: dataUri } },
        { type: 'text', text: PROMPT }
      ]
    }]
  })
  const options = {
    hostname: conf.host,
    path: conf.path,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + apiKey,
      'Content-Length': Buffer.byteLength(payload)
    },
    timeout: 50000
  }
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let body = ''
      res.on('data', d => { body += d })
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error('DashScope HTTP ' + res.statusCode + ': ' + body.slice(0, 300)))
          return
        }
        resolve(body)
      })
    })
    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error('请求超时')))
    req.write(payload)
    req.end()
  })
}

function clamp01(v) {
  v = Number(v)
  if (isNaN(v)) return 0
  if (v < 0) return 0
  if (v > 1) return 1
  return v
}

function parseBoxes(rawBody) {
  let content = ''
  try {
    const json = JSON.parse(rawBody)
    content = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content
    if (Array.isArray(content)) content = content.map(c => (c && c.text) || '').join('')
  } catch (e) {
    throw new Error('无法解析模型返回')
  }
  if (!content) return []

  let text = content.replace(/```json/gi, '').replace(/```/g, '').trim()
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start >= 0 && end > start) text = text.slice(start, end + 1)

  let arr
  try { arr = JSON.parse(text) } catch (e) { return [] }
  if (!Array.isArray(arr)) return []

  const items = []
  arr.slice(0, 15).forEach(it => {
    if (!it || !Array.isArray(it.box) || it.box.length < 4) return
    let [x1, y1, x2, y2] = it.box.map(Number)
    if ([x1, y1, x2, y2].some(v => isNaN(v))) return
    // 若是 0~1000 制（任一值 > 1.5），统一除以 1000
    if (Math.max(x1, y1, x2, y2) > 1.5) { x1 /= 1000; y1 /= 1000; x2 /= 1000; y2 /= 1000 }
    x1 = clamp01(x1); y1 = clamp01(y1); x2 = clamp01(x2); y2 = clamp01(y2)
    const x = Math.min(x1, x2), y = Math.min(y1, y2)
    const w = Math.abs(x2 - x1), h = Math.abs(y2 - y1)
    if (w < 0.02 || h < 0.02) return // 过小的框丢弃
    items.push({
      box: { x, y, w, h },
      label: it.label ? String(it.label).slice(0, 16) : ''
    })
  })
  return items
}

exports.main = async (event) => {
  const { fileID } = event || {}
  if (!fileID) return { ok: false, msg: '缺少 fileID' }

  const { apiKey, model } = await loadConfig()
  if (!apiKey) return { ok: false, msg: '未配置 API Key：请在数据库 ' + conf.configCollection + '/' + conf.configDocId + ' 写入 apiKey' }

  try {
    const dl = await cloud.downloadFile({ fileID })
    const base64 = dl.fileContent.toString('base64')
    const dataUri = 'data:' + extToMime(fileID) + ';base64,' + base64
    const rawBody = await callQwen(apiKey, model, dataUri)
    const items = parseBoxes(rawBody)
    return { ok: true, items }
  } catch (e) {
    console.error('detectItems error:', e)
    return { ok: false, msg: (e && e.message) || '识别失败' }
  }
}
