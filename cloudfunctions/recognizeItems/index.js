/* ============================================================
   云函数 recognizeItems
   入参：{ fileID }  —— 云存储中的整箱物品照片
   出参：{ ok, items:[{name, keywords}], msg }
   逻辑：下载图片 → base64 → 调用通义千问 Qwen-VL → 解析为物品清单
   ============================================================ */
const cloud = require('wx-server-sdk')
const https = require('https')
const conf = require('./config')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const PROMPT = [
  '你是收纳助手。请识别这张照片里摊开的独立物品，用于家庭收纳记录。',
  '要求：',
  '1. 只输出 JSON 数组，不要任何解释、不要 markdown 代码块。',
  '2. 每个元素格式：{"name": "简洁中文物品名(不超过8字)", "keywords": ["检索词1","检索词2","检索词3"]}。',
  '3. keywords 为 3-5 个中文检索词，包含同义词、用途或所属季节，方便以后模糊搜索。',
  '4. 合并明显重复的同类物品；最多识别 12 件。',
  '示例：[{"name":"灰色毛衣","keywords":["毛衣","保暖","上衣","冬天"]}]'
].join('\n')

// 读取配置：环境变量 > 数据库(app_config/dashscope) > config.js 兜底
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
  } catch (e) {
    // 文档不存在或集合未建，忽略，走兜底
  }
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
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: dataUri } },
          { type: 'text', text: PROMPT }
        ]
      }
    ]
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

function parseItems(rawBody) {
  let content = ''
  try {
    const json = JSON.parse(rawBody)
    content = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content
    if (Array.isArray(content)) {
      // 兼容部分返回 content 为数组的情况
      content = content.map(c => (c && c.text) || '').join('')
    }
  } catch (e) {
    throw new Error('无法解析模型返回')
  }
  if (!content) return []

  // 去掉可能的 ```json ``` 包裹，截取首个 [ 到末个 ]
  let text = content.replace(/```json/gi, '').replace(/```/g, '').trim()
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start >= 0 && end > start) text = text.slice(start, end + 1)

  let arr
  try {
    arr = JSON.parse(text)
  } catch (e) {
    return []
  }
  if (!Array.isArray(arr)) return []

  return arr
    .filter(it => it && it.name)
    .slice(0, 12)
    .map(it => ({
      name: String(it.name).slice(0, 16),
      keywords: Array.isArray(it.keywords) ? it.keywords.map(k => String(k)).slice(0, 6) : []
    }))
}

exports.main = async (event) => {
  const { fileID } = event || {}
  if (!fileID) return { ok: false, msg: '缺少 fileID' }

  const { apiKey, model } = await loadConfig()
  if (!apiKey) {
    return { ok: false, msg: '未配置 API Key：请在数据库 ' + conf.configCollection + '/' + conf.configDocId + ' 写入 apiKey 字段' }
  }

  try {
    const dl = await cloud.downloadFile({ fileID })
    const base64 = dl.fileContent.toString('base64')
    const dataUri = 'data:' + extToMime(fileID) + ';base64,' + base64

    const rawBody = await callQwen(apiKey, model, dataUri)
    const items = parseItems(rawBody)
    return { ok: true, items }
  } catch (e) {
    console.error('recognizeItems error:', e)
    return { ok: false, msg: (e && e.message) || '识别失败' }
  }
}
