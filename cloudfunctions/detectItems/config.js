/* 通义千问 Qwen-VL 配置（与 recognizeItems 一致）
   API Key 优先级：环境变量 DASHSCOPE_API_KEY > 数据库 app_config/dashscope > 本文件 apiKey */
module.exports = {
  configCollection: 'app_config',
  configDocId: 'dashscope',
  apiKey: '',
  model: 'qwen-vl-max',
  host: 'dashscope.aliyuncs.com',
  path: '/compatible-mode/v1/chat/completions'
}
