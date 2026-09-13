// NODE_PATH=<installed node_modules> node feishu-docs/check_theme.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

function contrast(foreground, background) {
  const luminance = value => {
    const rgb = value.match(/[0-9.]+/g).slice(0, 3).map(Number).map(x => x / 255)
      .map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4);
    return .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
  };
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (light + .05) / (dark + .05);
}

(async () => {
  const root = path.dirname(__dirname);
  const typora = process.env.TYPORA_STYLE || 'C:/Program Files/Typora/resources/style';
  const fixture = fs.readFileSync(path.join(root, 'md2card', 'audit.html'), 'utf8')
    .replace(/<script>[\s\S]*?<\/script>/, '');
  const css = fs.readFileSync(path.join(root, 'feishu-docs.css'), 'utf8');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    for (const width of [1200, 600, 360]) {
      await page.setViewportSize({ width, height: 900 });
      await page.setContent(fixture);
      for (const name of ['base.css', 'base-control.css', 'window.css', 'codemirror.css']) {
        await page.addStyleTag({ content: fs.readFileSync(path.join(typora, name), 'utf8') });
      }
      await page.addStyleTag({ content: css });
      await page.evaluate(() => {
        const write = document.querySelector('#write');
        write.insertAdjacentHTML('beforeend', '<div class="md-toc"><a class="md-toc-inner">目录条目</a></div><div class="md-math-block">E = mc²</div><div class="footnotes-area"><div class="footnote-line">1. 脚注内容</div></div>');
        const p = document.createElement('p');
        p.textContent = '长文滚动测试：飞书文档风格应保持轻快、清晰和稳定。'.repeat(120);
        write.append(p);
        document.body.insertAdjacentHTML('beforeend', '<aside id="typora-sidebar" style="position:fixed;left:-9999px">侧栏</aside><div id="typora-source" style="position:fixed;left:-9999px">源码</div>');
      });
      const metrics = await page.evaluate(() => {
        const content = document.querySelector('content');
        const write = document.querySelector('#write');
        const line = write.querySelector('.CodeMirror-line');
        const before = write.getBoundingClientRect().top;
        content.scrollTop = 500;
        const moved = before - write.getBoundingClientRect().top;
        content.scrollTop = 0;
        return {
          moved,
          overflow: getComputedStyle(content).overflowY,
          extraWidth: content.scrollWidth - content.clientWidth,
          fontSize: getComputedStyle(write.querySelector('p')).fontSize,
          lineHeight: getComputedStyle(write.querySelector('p')).lineHeight,
          ink: getComputedStyle(write.querySelector('p')).color,
          paper: getComputedStyle(write).backgroundColor,
          h1: getComputedStyle(write.querySelector('h1')).fontSize,
          h2: getComputedStyle(write.querySelector('h2')).fontSize,
          mark: getComputedStyle(write.querySelector('mark')).backgroundColor,
          inlineCode: getComputedStyle(write.querySelector('p code')).color,
          inlineCodeBackground: getComputedStyle(write.querySelector('p code')).backgroundColor,
          kbd: getComputedStyle(write.querySelector('kbd')).borderBottomWidth,
          prePadding: getComputedStyle(line).paddingTop,
          preBorder: getComputedStyle(line).borderTopWidth,
          preBackground: getComputedStyle(line).backgroundColor,
          alertFills: [...write.querySelectorAll('.md-alert')].map(el => getComputedStyle(el).backgroundColor),
          alertColors: [...write.querySelectorAll('.md-alert')].map(el => getComputedStyle(el).borderLeftColor),
          alertTitleColors: [...write.querySelectorAll('.md-alert-text')].map(el => getComputedStyle(el).color),
          tableBorder: getComputedStyle(write.querySelector('table')).borderTopWidth,
          tocBorder: getComputedStyle(write.querySelector('.md-toc')).borderTopWidth,
          mathBorder: getComputedStyle(write.querySelector('.md-math-block')).borderTopWidth,
          footnoteBorder: getComputedStyle(write.querySelector('.footnotes-area')).borderTopWidth,
          sidebarBackground: getComputedStyle(document.querySelector('#typora-sidebar')).backgroundColor,
          sourceBackground: getComputedStyle(document.querySelector('#typora-source')).backgroundColor,
        };
      });
      assert.equal(metrics.moved, 500);
      assert.equal(metrics.overflow, 'auto');
      assert(metrics.extraWidth <= 1, `${width}: page overflow ${metrics.extraWidth}`);
      assert.equal(metrics.fontSize, '16px');
      assert.equal(metrics.lineHeight, '28px');
      assert.equal(metrics.h1, width <= 720 ? '28px' : '32px');
      assert.equal(metrics.h2, width <= 720 ? '22.4px' : '26px');
      assert(contrast(metrics.ink, metrics.paper) >= 12);
      assert.equal(metrics.mark, 'rgb(255, 241, 184)');
      assert(contrast(metrics.inlineCode, metrics.inlineCodeBackground) >= 4.5);
      assert.equal(metrics.kbd, '2px');
      assert.equal(metrics.prePadding, '0px');
      assert.equal(metrics.preBorder, '0px');
      assert.equal(metrics.preBackground, 'rgba(0, 0, 0, 0)');
      assert.equal(new Set(metrics.alertFills).size, 5);
      assert.equal(new Set(metrics.alertColors).size, 5);
      assert.deepEqual(metrics.alertTitleColors, metrics.alertColors);
      assert(metrics.alertTitleColors.every((color, index) => contrast(color, metrics.alertFills[index]) >= 4.5));
      assert.equal(metrics.tableBorder, '1px');
      assert.equal(metrics.tocBorder, '1px');
      assert.equal(metrics.mathBorder, '1px');
      assert.equal(metrics.footnoteBorder, '1px');
      assert.equal(metrics.sidebarBackground, 'rgb(245, 246, 247)');
      assert.equal(metrics.sourceBackground, 'rgb(255, 255, 255)');
      const checkbox = page.locator('input[type=checkbox]').last();
      await checkbox.check();
      assert(await checkbox.isChecked());
      await page.locator('#write > p').first().click();
      await page.keyboard.press('End');
      await page.keyboard.type(' EDIT-CHECK');
      assert((await page.locator('#write').innerText()).includes('EDIT-CHECK'));
      await page.locator('.CodeMirror-line').first().evaluate(el => { el.textContent = 'x'.repeat(600); });
      const codeScroll = await page.evaluate(() => {
        const cm = document.querySelector('.CodeMirror-scroll');
        cm.scrollLeft = 200;
        const content = document.querySelector('content');
        return [cm.scrollLeft, content.scrollWidth - content.clientWidth];
      });
      assert(codeScroll[0] > 0 && codeScroll[1] <= 1, `${width}: code overflow ${codeScroll}`);
      if (process.env.FEISHU_SCREENSHOT && width === 1200) {
        await page.locator('.CodeMirror-line').first().evaluate(el => { el.textContent = 'const value = 42;'; });
        await page.setViewportSize({ width, height: 1600 });
        await page.screenshot({ path: process.env.FEISHU_SCREENSHOT });
        await page.evaluate(() => { document.querySelector('content').scrollTop = 1050; });
        await page.screenshot({ path: process.env.FEISHU_SCREENSHOT.replace(/\.png$/i, '-details.png') });
      }
    }
    console.log('PASS: Feishu Docs theme at 1200/600/360px; scroll, edit, lists, alerts, tables and CodeMirror.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
