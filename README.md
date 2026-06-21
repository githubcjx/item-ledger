# 「物账本」收纳记录 · 微信小程序

> 把东西收进箱子时拍张照，过段时间想找时，一搜就知道在哪个箱子、箱子又在哪。

当前版本：**v0.2 两步识别 + 云开发**。
数据存于微信云开发（云数据库 + 云存储），物品识别接阿里云 **通义千问 Qwen-VL**。
（本目录为小程序项目根目录；产品文档与原型在上一级 `../物账本-需求设计文档.md`、`../物账本-收纳记录-原型.html`。）

## 已实现

- **箱子 CRUD**：新建（四步流程）/ 查看详情 / 重命名 / 改备注 / 删除。
- **云端存储**：箱子数据存云数据库 `boxes` 集合；封面/物品/位置照片存云存储（字段存 fileID）。
- **两步识别（v0.2）**：新建第 3 步拍全局照 →
  ① 云函数 `detectItems` 调 Qwen-VL **粗识别画框**（数数 + 边界框）→
  ② 点框时 `nameRegion` 对该区域**细识别命名**。
  原图常驻参照，覆盖三类纠错：名字错（点名字改）、多识别（点 ✕ 删框）、漏识别（空白处**拖拽补框**后自动命名）。
  **兜底退路**：识别太难时「整箱打个标签」记为一条粗物品。仍保留纯手动录入。
- **关键词模糊搜索**：对「物品名 + AI 关键词 + 箱名」做模糊匹配（含同义词，搜「过冬」能命中「羽绒服」）。
- **溯源路径**：搜索结果以「物品 → 箱子 → 位置」三段式卡片呈现。
- **SVG 线性图标**：全站图标由 `components/icon` 用 SVG 描边绘制；右上角按钮已避让微信胶囊。

## 目录结构（项目根 = 本目录）

```
project.config.json         开发者工具配置（cloudfunctionRoot: cloudfunctions/）
app.js                      初始化云开发 + 自定义导航栏 + 胶囊避让(menuRight)
config.js                   ★ 填写 cloudEnv；云函数名映射
app.json / app.wxss         路由、设计令牌
components/icon/            SVG 线性图标组件
utils/
├── store.js                云数据层 + 图片上传 + AI 调用封装(detectItems/nameRegion)
└── search.js               v1 关键词模糊匹配（纯函数 searchInBoxes）
pages/  index / search / box-new / box-detail
cloudfunctions/
├── detectItems/            粗识别·画框（返回归一化边界框）
├── nameRegion/             细识别·对单框命名
└── recognizeItems/         v0.1 一次性识别（保留，已被两步识别取代）
```

## 部署步骤（首次）

1. **开通云开发**：开发者工具顶部「云开发」→ 创建环境，复制环境 ID。
2. **填环境 ID**：写入 `config.js` 的 `cloudEnv`。
3. **建数据库集合**：
   - `boxes`，权限「仅创建者可读写」。
   - `app_config`，权限「仅管理端可读写（私有）」。
4. **配置 AI Key（存数据库）**：在 [DashScope](https://dashscope.console.aliyun.com/) 建 API Key；
   在 `app_config` 加一条记录：
   ```json
   { "_id": "dashscope", "apiKey": "sk-你的Key", "model": "qwen-vl-max" }
   ```
   （优先级：环境变量 `DASHSCOPE_API_KEY` > 数据库 > 各云函数 config.js。换 Key 只改这条记录。）
5. **部署云函数**：分别右键 `cloudfunctions/detectItems`、`cloudfunctions/nameRegion`
   →「上传并部署：云端安装依赖」。（`recognizeItems` 可不部署。）
6. 编译预览；首页空态可「载入演示数据」。

## 数据模型（boxes 集合）

```
{
  _id, _openid,
  name, note,
  coverPhoto,                 // 云存储 fileID
  locationName, locationPhoto,
  items: [ { itemId, name, photo, keywords:[] } ],
  createdAt, updatedAt        // serverDate
}
```

## 待办 / 后续版本

- **设计稿对齐**：待 `claude_design` 连接器授权（`/design-login`）后，拉取 `物账本 收纳记录.dc.html` 做视觉校对。
- **检测效果验证**：Qwen-VL 自动画框准确率是最大不确定点；若偏差大，已具备「全手动拖拽补框」降级路径。
- **v0.3 语义向量搜索**：物品描述转 embedding，语义相似度召回；位置管理、箱子挪位提醒。
