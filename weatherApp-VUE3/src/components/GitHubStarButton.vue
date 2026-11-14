<script setup>
// GitHub 星标跳转按钮：复刻 React 版（hover 时 GitHub 图标上移淡出、Star 图标带闪烁星点上移淡入）。
// 纯 Vue + 内联 SVG，无 framer-motion 依赖；动画用 CSS 过渡（cubic-bezier 模拟弹簧过冲）。
// 仓库地址来自 git remote `github`：https://github.com/MaSaka26/weatherApp
const GITHUB_URL = 'https://github.com/MaSaka26/weatherApp'
</script>

<template>
  <a
    class="gh-star-btn"
    :href="GITHUB_URL"
    target="_blank"
    rel="noopener noreferrer"
    title="点个星吧"
    aria-label="在 GitHub 上给项目点个星"
  >
    <span class="gh-icon-wrap">
      <span class="gh-icon gh-icon-github" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
          <path d="M9 18c-4.51 2-5-2-7-2" />
        </svg>
      </span>
      <span class="gh-icon gh-icon-star" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
        <svg class="gh-sparkle" viewBox="0 0 24 24" width="10" height="10" fill="currentColor" aria-hidden="true">
          <path d="M12 2l2.4 7.6H22l-6.2 4.5 2.4 7.6-6.2-4.5-6.2 4.5 2.4-7.6L2 9.6h7.6z" />
        </svg>
      </span>
    </span>
    <span class="gh-star-label">Star on GitHub</span>
  </a>
</template>

<style scoped>
.gh-star-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 36px;
  padding: 0 24px;
  border-radius: 40px;
  border: 1px solid rgba(255, 255, 255, 0.05);
  background: rgba(255, 255, 255, 0.04);
  color: #fff;
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  letter-spacing: -0.01em;
  text-decoration: none;
  white-space: nowrap;
  cursor: pointer;
  transition: background 0.15s ease, transform 0.15s ease, border-color 0.15s ease;
}
.gh-star-btn:hover {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.12);
}
.gh-star-btn:active {
  transform: scale(0.96);
}

.gh-icon-wrap {
  position: relative;
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  margin-right: 10px;
}
.gh-icon {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.gh-icon-github {
  opacity: 1;
  transform: translateY(0) scale(1);
  transition: opacity 0.22s ease, transform 0.28s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.gh-star-btn:hover .gh-icon-github {
  opacity: 0;
  transform: translateY(-15px) scale(0.8);
}
.gh-icon-star {
  color: #facc15;
  opacity: 0;
  transform: translateY(15px) scale(0.8);
  transition: opacity 0.22s ease, transform 0.28s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.gh-star-btn:hover .gh-icon-star {
  opacity: 1;
  transform: translateY(0) scale(1);
}
.gh-sparkle {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 10px;
  height: 10px;
  color: #fde68a;
  opacity: 0;
  transform: scale(0) rotate(-45deg) translateY(10px);
  transition: opacity 0.22s ease, transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) 0.05s;
}
.gh-star-btn:hover .gh-sparkle {
  opacity: 1;
  transform: scale(1) rotate(0) translateY(0);
}

.gh-star-label {
  line-height: 1;
}
</style>
