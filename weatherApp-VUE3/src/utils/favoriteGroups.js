/**
 * 按国内 / 国外构建收藏分组，但只包含确实有收藏城市的分类。
 * 空分类不返回，避免下拉里出现「没有国外城市却仍显示国外表头」的问题。
 * 纯函数，便于 node --test 直接覆盖。
 */
export function buildFavoriteGroups(domestic = [], foreign = []) {
  return [
    { key: 'domestic', label: '国内', cities: domestic },
    { key: 'foreign', label: '国外', cities: foreign },
  ].filter((group) => group.cities.length > 0)
}
