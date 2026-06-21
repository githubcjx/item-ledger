/* ============================================================
   搜索 · v1 关键词模糊匹配（纯函数）
   传入已加载的 boxes 数组，对「物品名 + 关键词 + 箱名」做模糊匹配，
   输出溯源结果（物品 → 箱子 → 位置）。
   ============================================================ */

function norm(s) {
  return (s || '').toString().toLowerCase().trim()
}

function isSubsequence(query, text) {
  let i = 0
  for (let j = 0; j < text.length && i < query.length; j++) {
    if (text[j] === query[i]) i++
  }
  return i === query.length
}

function scoreText(query, text) {
  if (!query || !text) return 0
  if (text === query) return 100
  if (text.indexOf(query) >= 0) return 80
  if (query.indexOf(text) >= 0) return 60
  const tokens = query.split(/\s+/).filter(Boolean)
  let best = 0
  tokens.forEach(t => {
    if (t.length >= 1 && text.indexOf(t) >= 0) best = Math.max(best, 50)
  })
  if (best) return best
  if (query.length >= 2 && isSubsequence(query, text)) return 30
  return 0
}

/**
 * @param {string} rawQuery
 * @param {Array} boxes  已加载的箱子数组
 * @returns {Array} [{ item, box, score, matchOn }]
 */
function searchInBoxes(rawQuery, boxes) {
  const query = norm(rawQuery)
  if (!query) return []
  const results = []

  ;(boxes || []).forEach(box => {
    const boxNameScore = scoreText(query, norm(box.name)) * 0.6
    ;(box.items || []).forEach(item => {
      const nameScore = scoreText(query, norm(item.name))
      let kwScore = 0
      ;(item.keywords || []).forEach(k => {
        kwScore = Math.max(kwScore, scoreText(query, norm(k)) * 0.9)
      })
      const score = Math.max(nameScore, kwScore, boxNameScore)
      if (score > 0) {
        results.push({
          item,
          box,
          score,
          matchOn: nameScore >= kwScore && nameScore >= boxNameScore
            ? 'name'
            : (kwScore >= boxNameScore ? 'keyword' : 'box')
        })
      }
    })
  })

  results.sort((a, b) => b.score - a.score)
  return results
}

module.exports = { searchInBoxes }
