// 临时脚本：检测渲染进程源码文件中文是否完好（被 PowerShell ANSI 写坏过）
const fs = require('fs')
const path = require('path')

function walk(dir) {
  let out = []
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f)
    const st = fs.statSync(p)
    if (st.isDirectory()) out = out.concat(walk(p))
    else if (/\.(tsx?|css|html)$/.test(f)) out.push(p)
  }
  return out
}

const roots = ['src/renderer/src', 'src/main', 'src/preload', 'src/shared']
const mojibakeMarkers = ['涓', '鎴', '鐢', '锛', '璇', '鍒', '鑺', '鐨', '鏄', '浣']
let bad = 0
for (const root of roots) {
  for (const f of walk(root)) {
    const t = fs.readFileSync(f, 'utf8')
    const hasCJK = /[\u4e00-\u9fff]/.test(t)
    const moji = mojibakeMarkers.filter((m) => t.includes(m))
    // 完好中文应能找到常见词；乱码特征字出现即为损坏
    if (moji.length >= 2) {
      bad++
      console.log('CORRUPT?', f, '->', moji.join(''))
    } else if (!hasCJK) {
      console.log('no-CJK ', f)
    }
  }
}
console.log(bad === 0 ? 'ALL_CLEAN' : `FOUND ${bad} SUSPECT FILES`)
