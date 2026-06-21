/* ============================================================
   通义千问 Qwen-VL 配置
   推荐做法：在云开发控制台为本云函数设置环境变量 DASHSCOPE_API_KEY，
   不要把真实 Key 提交到代码仓库。
   若未设置环境变量，则回退读取下面的 apiKey（仅供本地联调）。
   ============================================================ */
module.exports = {
  // ★ 推荐：把 API Key 存到云数据库集合（见下），更新云函数无需重填。
  //   读取优先级：环境变量 DASHSCOPE_API_KEY > 数据库 > 本文件 apiKey。
  configCollection: 'app_config', // 存配置的集合名（权限请设为「仅管理端可读写/私有」）
  configDocId: 'dashscope',       // 配置文档 _id

  // 兜底：本地联调用（建议留空，改用数据库）
  apiKey: '',

  // 默认模型：qwen-vl-max（效果好）/ qwen-vl-plus（更便宜）；数据库里的 model 字段可覆盖
  model: 'qwen-vl-max',

  // DashScope OpenAI 兼容接口
  host: 'dashscope.aliyuncs.com',
  path: '/compatible-mode/v1/chat/completions'
}
