import test from 'node:test'
import assert from 'node:assert/strict'

import { mergeCandidates } from '../src/utils/candidateMerge.js'
import { toTraditional, hasChinese } from '../src/utils/zhVariant.js'

test('mergeCandidates: 同名不同国家全部保留，交用户自选', () => {
  const local = [{ leaf: '北京', countryCode: 'CN', lat: 39.905, lon: 116.405, levelLabel: '市' }]
  const global = [
    { leaf: '北京', countryCode: 'CN', lat: 35.209, lon: 110.733, levelLabel: '国内' }, // 山西同名地
    { leaf: '伦敦', countryCode: 'GB', lat: 51.509, lon: -0.126, levelLabel: 'GB' },
    { leaf: '伦敦', countryCode: 'CA', lat: 42.983, lon: -81.233, levelLabel: 'CA' },
  ]
  const merged = mergeCandidates(local, global)
  // 本地北京 + 山西北京 + 英国伦敦 + 加拿大伦敦 都在
  assert.equal(merged.length, 4)
  const londons = merged.filter((m) => m.leaf === '伦敦')
  assert.equal(londons.length, 2)
  assert.ok(londons.some((m) => m.countryCode === 'GB'))
  assert.ok(londons.some((m) => m.countryCode === 'CA'))
  // 全球项带 isGlobal，本地项不带
  assert.ok(londons.every((m) => m.isGlobal))
  assert.ok(!merged.find((m) => m.lat === 39.905)?.isGlobal)
})

test('mergeCandidates: 坐标完全相同的中英双名只保留一条', () => {
  const local = []
  const global = [
    { leaf: '倫敦', altName: 'London', countryCode: 'GB', lat: 51.509, lon: -0.126 },
    { leaf: 'London', countryCode: 'GB', lat: 51.509, lon: -0.126 },
  ]
  const merged = mergeCandidates(local, global)
  assert.equal(merged.length, 1)
})

test('mergeCandidates: 本地与全球指向同一坐标时去重', () => {
  const local = [{ leaf: '北京', countryCode: 'CN', lat: 39.905, lon: 116.405 }]
  const global = [{ leaf: 'Beijing', countryCode: 'CN', lat: 39.905, lon: 116.405 }]
  const merged = mergeCandidates(local, global)
  assert.equal(merged.length, 1)
  assert.ok(!merged[0].isGlobal) // 本地优先
})

test('mergeCandidates: 总数上限 12', () => {
  const many = Array.from({ length: 20 }, (_, i) => ({
    leaf: `C${i}`, countryCode: 'XX', lat: i, lon: i,
  }))
  assert.equal(mergeCandidates([], many).length, 12)
})

test('toTraditional: 常见境外城市译名简 -> 繁', () => {
  assert.equal(toTraditional('伦敦'), '倫敦')
  assert.equal(toTraditional('东京'), '東京')
  assert.equal(toTraditional('纽约'), '紐約')
  assert.equal(toTraditional('剑桥'), '劍橋')
  // 无差异字时不生成变体，避免重复请求
  assert.equal(toTraditional('北京'), '')
  assert.equal(toTraditional('巴黎'), '')
  assert.equal(toTraditional(''), '')
})

test('hasChinese: 只对中文输入查繁体变体', () => {
  assert.equal(hasChinese('伦敦'), true)
  assert.equal(hasChinese('London'), false)
  assert.equal(hasChinese('123'), false)
})
