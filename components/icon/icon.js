/* ============================================================
   线性图标组件 · 用 SVG 描边绘制，颜色/尺寸可配
   用法：<icon name="search" size="36" color="#6B6356" />
   原理：把 SVG 字符串编码为 base64 data URI 交给 <image> 渲染。
   ============================================================ */

const ICONS = {
  back: '<path d="M15 5l-7 7 7 7"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  box: '<path d="M3 7.5l9-4.5 9 4.5v9l-9 4.5-9-4.5z"/><path d="M3 7.5l9 4.5 9-4.5"/><path d="M12 12v9"/>',
  pin: '<path d="M12 21c4-4.5 6-7.6 6-10.5A6 6 0 0 0 6 10.5C6 13.4 8 16.5 12 21z"/><circle cx="12" cy="10.5" r="2.2"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5 5l2.1 2.1M16.9 16.9 19 19M19 5l-2.1 2.1M7.1 16.9 5 19"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chevron: '<path d="M9 5l7 7-7 7"/>',
  edit: '<path d="M4 20l4.5-1 9.5-9.5-3.5-3.5L5 15.5z"/><path d="M13.5 6.5l3.5 3.5"/>',
  camera: '<path d="M4 8h3.5l1.5-2h6l1.5 2H20v11H4z"/><circle cx="12" cy="13" r="3.2"/>',
  check: '<path d="M5 13l4 4 10-10"/>',
  bookmark: '<path d="M7 4h10v16l-5-3.5L7 20z"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  scan: '<path d="M4 8V5a1 1 0 0 1 1-1h3M20 8V5a1 1 0 0 0-1-1h-3M4 16v3a1 1 0 0 0 1 1h3M20 16v3a1 1 0 0 1-1 1h-3"/><path d="M4 12h16"/>',
  bulb: '<path d="M9.5 18h5M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5.9 1.2 1 1.9v.2h5v-.2c.1-.7.4-1.4 1-1.9A6 6 0 0 0 12 3z"/>',
  sparkle: '<path d="M12 4l1.8 4.7L18.5 10l-4.7 1.3L12 16l-1.8-4.7L5.5 10l4.7-1.3z"/>',
  trash: '<path d="M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13"/>',
  cloud: '<path d="M7 18h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6 9.5 3.5 3.5 0 0 0 7 18z"/>'
}

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
function base64(str) {
  let out = ''
  for (let i = 0; i < str.length; i += 3) {
    const c1 = str.charCodeAt(i)
    const has2 = i + 1 < str.length
    const has3 = i + 2 < str.length
    const c2 = has2 ? str.charCodeAt(i + 1) : 0
    const c3 = has3 ? str.charCodeAt(i + 2) : 0
    const e1 = c1 >> 2
    const e2 = ((c1 & 3) << 4) | (c2 >> 4)
    const e3 = has2 ? (((c2 & 15) << 2) | (c3 >> 6)) : 64
    const e4 = has3 ? (c3 & 63) : 64
    out += CHARS.charAt(e1) + CHARS.charAt(e2) +
      (e3 === 64 ? '=' : CHARS.charAt(e3)) +
      (e4 === 64 ? '=' : CHARS.charAt(e4))
  }
  return out
}

Component({
  properties: {
    name: { type: String, value: '' },
    size: { type: Number, value: 32 },
    color: { type: String, value: '#2B2620' },
    stroke: { type: Number, value: 2 }
  },
  data: { src: '' },
  observers: {
    'name, color, stroke': function (name, color, stroke) {
      this._build(name, color, stroke)
    }
  },
  lifetimes: {
    attached() {
      this._build(this.data.name, this.data.color, this.data.stroke)
    }
  },
  methods: {
    _build(name, color, stroke) {
      const inner = ICONS[name] || ''
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="' +
        color + '" stroke-width="' + stroke +
        '" stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>'
      this.setData({ src: 'data:image/svg+xml;base64,' + base64(svg) })
    }
  }
})
