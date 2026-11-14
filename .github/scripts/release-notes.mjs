// 从根 README.md 的「## 更新日志」里抽出某个版本的条目，生成 GitHub Release 说明。
// 用法：node .github/scripts/release-notes.mjs v0.1.12 [README.md]
// 找不到对应版本时以退出码 1 结束，交由 CI 回退到 --generate-notes。
import { readFileSync } from 'node:fs'

const tag = process.argv[2]
const readmePath = process.argv[3] || 'README.md'

if (!tag) {
  console.error('usage: node release-notes.mjs <tag> [readme]')
  process.exit(2)
}

const lines = readFileSync(readmePath, 'utf8').split(/\r?\n/)

// README 的标题带日期，如 `### v0.1.12 — 2026-11-14`，所以按前缀匹配
const start = lines.findIndex((line) => line.trim().startsWith(`### ${tag}`))
if (start === -1) {
  console.error(`no changelog entry for ${tag}`)
  process.exit(1)
}

const body = []
for (const line of lines.slice(start + 1)) {
  const trimmed = line.trim()
  // 下一个版本小标题或章节分隔线即结束
  if (/^###\s/.test(trimmed) || trimmed === '---') break
  // README 里的小节用 **新增** / **修复** / **工程**，Release 里降一级成 ### 标题
  const heading = trimmed.match(/^\*\*(.+)\*\*$/)
  body.push(heading ? `### ${heading[1]}` : line)
}

// 去掉首尾空行
while (body.length && !body[0].trim()) body.shift()
while (body.length && !body[body.length - 1].trim()) body.pop()

if (body.length === 0) {
  console.error(`changelog entry for ${tag} is empty`)
  process.exit(1)
}

const site = 'https://masaka26.github.io/weatherApp/'
process.stdout.write(`${body.join('\n')}\n\n### 在线预览\n- ${site}\n`)
