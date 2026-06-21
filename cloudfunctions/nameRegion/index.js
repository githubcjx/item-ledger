/* ============================================================
   云函数 nameRegion · 细识别（对单个框命名）
   入参：{ fileID, box:{x,y,w,h} }  —— box 为归一化坐标
   出参：{ ok, name, keywords, msg }
   ============================================================ */
const cloud = require('wx-server-sdk')
const https = require('https')
const conf = require('./config')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function buildPrompt(box) {
  const x1 = (box.x).toFixed(3)
  const y1 = (box.y).toFixed(3)
  const x2 = (box.x + box.w).toFixed(3)
  const y2 = (box.y + box.h).toFixed(3)
  return [
    '你是收纳助手。下面给你一张照片，请只识别其中位于归一化区域',
    '[' + x1 + ', ' + y1 + ', ' + x2 + ', ' + y2 + ']（0~1，左上角到右下角，相对图片宽高）内的那一件物品。',
    '只输出 JSON，不要解释、不要 markdown：',
    '{"name":"简洁中文物品名(不超过8字)","keywords":["检索词1","检索词2","检索词3"]}',
    'keywords 为 3-5 个中文检索词，含同义词、用途或所属季节，便于以后模糊搜索。'
  ].join('\n')
}

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

function callQwen(apiKey, model, dataUri, prompt) {
  const payload = JSON.stringify({
    model: model,
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: dataUri } },
        { type: 'text', text: prompt }
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

function parseOne(rawBody) {
  let content = ''
  try {
    const json = JSON.parse(rawBody)
    content = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content
    if (Array.isArray(content)) content = content.map(c => (c && c.text) || '').join('')
  } catch (e) {
    throw new Error('无法解析模型返回')
  }
  if (!content) return { name: '', keywords: [] }

  let text = content.replace(/```json/gi, '').replace(/```/g, '').trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) text = text.slice(start, end + 1)

  let obj
  try { obj = JSON.parse(text) } catch (e) { return { name: '', keywords: [] } }
  return {
    name: obj && obj.name ? String(obj.name).slice(0, 16) : '',
    keywords: obj && Array.isArray(obj.keywords) ? obj.keywords.map(k => String(k)).slice(0, 6) : []
  }
}

exports.main = async (event) => {
  const { fileID, box } = event || {}
  if (!fileID) return { ok: false, msg: '缺少 fileID' }
  if (!box || typeof box.x !== 'number') return { ok: false, msg: '缺少 box 坐标' }

  const { apiKey, model } = await loadConfig()
  if (!apiKey) return { ok: false, msg: '未配置 API Key：请在数据库 ' + conf.configCollection + '/' + conf.configDocId + ' 写入 apiKey' }

  try {
    const dl = await cloud.downloadFile({ fileID })
    const base64 = dl.fileContent.toString('base64')
    const dataUri = 'data:' + extToMime(fileID) + ';base64,' + base64
    const rawBody = await callQwen(apiKey, model, dataUri, buildPrompt(box))
    const one = parseOne(rawBody)
    return { ok: true, name: one.name, keywords: one.keywords }
  } catch (e) {
    console.error('nameRegion error:', e)
    return { ok: false, msg: (e && e.message) || '命名失败' }
  }
}
