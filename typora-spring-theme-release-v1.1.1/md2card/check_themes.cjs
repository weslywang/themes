// Run: NODE_PATH=<installed node_modules> node md2card/check_themes.cjs
// This tests CSS against Typora's installed styles, not the running Typora app.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');

function contrast(foreground, background) {
  const luminance = value => {
    const scale = value.startsWith('color(srgb') ? 1 : 255;
    const rgb = value.match(/[\d.]+/g).slice(0, 3).map(Number).map(x => x / scale)
      .map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4);
    return .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
  };
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (light + .05) / (dark + .05);
}

(async () => {
  execFileSync('python', [path.join(__dirname, 'build_themes.py'), '--check'], { stdio: 'inherit' });
  const root = path.dirname(__dirname);
  const themes = fs.readdirSync(root).filter(x => /^md2card-.*\.css$/.test(x));
  assert.equal(themes.length, 13);
  const typora = process.env.TYPORA_STYLE || 'C:/Program Files/Typora/resources/style';
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    const fixture = fs.readFileSync(path.join(__dirname, 'audit.html'), 'utf8')
      .replace(/<script>[\s\S]*?<\/script>/, '');
    const base = fs.readFileSync(path.join(__dirname, 'base.css'), 'utf8');
    const report = [];
    for (const file of themes) {
      const css = fs.readFileSync(path.join(root, file), 'utf8');
      assert(!/attr\(data-|backdrop-filter|var\(--card-height\)/.test(css), file);
      for (const width of [1200, 600, 360]) {
        await page.setViewportSize({ width, height: 900 });
        await page.setContent(fixture);
        for (const name of ['base.css', 'base-control.css', 'window.css', 'codemirror.css']) {
          await page.addStyleTag({ content: fs.readFileSync(path.join(typora, name), 'utf8') });
        }
        await page.addStyleTag({ content: base + css.replace(/@import[^;]+;/, '') });
        await page.evaluate(() => {
          const write = document.querySelector('#write');
          const p = document.createElement('p');
          p.textContent = '长文滚动测试：文本应随着原生滚动容器移动。'.repeat(100);
          write.append(p);
        });
        const geometry = await page.evaluate(() => {
          const content = document.querySelector('content');
          const write = document.querySelector('#write');
          const pre = document.querySelector('.CodeMirror-line');
          const style = getComputedStyle(pre);
          const before = write.getBoundingClientRect().top;
          content.scrollTop = 500;
          const moved = before - write.getBoundingClientRect().top;
          content.scrollTop = 0;
          return {
            position: getComputedStyle(content).position,
            overflow: getComputedStyle(content).overflowY,
            extraWidth: content.scrollWidth - content.clientWidth,
            moved, prePadding: style.paddingTop, preBackground: style.backgroundColor,
            preBorder: style.borderTopWidth,
            fontSize: getComputedStyle(write.querySelector('p')).fontSize,
            height: write.offsetHeight,
            taskMarker: getComputedStyle(write.querySelector('.md-task-list-item'), '::before').content,
            ulMarker: getComputedStyle(write.querySelector('ol ul > li'), '::before').content,
            ulMarkerPosition: getComputedStyle(write.querySelector('ol ul > li'), '::before').position,
            ulMarkerTop: getComputedStyle(write.querySelector('ol ul > li'), '::before').top,
            ulMarkerTranslate: getComputedStyle(write.querySelector('ol ul > li'), '::before').translate,
            paper: getComputedStyle(write).backgroundColor,
            canvas: [write, document.body, document.documentElement]
              .map(el => getComputedStyle(el).backgroundColor)
              .find(color => !color.endsWith(', 0)')),
            dark: getComputedStyle(document.documentElement).colorScheme,
            strongWeight: Number(getComputedStyle(write.querySelector('strong')).fontWeight),
            emphasisColor: getComputedStyle(write.querySelector('em')).color,
            markColor: getComputedStyle(write.querySelector('mark')).color,
            markBackground: getComputedStyle(write.querySelector('mark')).backgroundColor,
            kbdBorderBottom: getComputedStyle(write.querySelector('kbd')).borderBottomWidth,
            footnoteRadius: getComputedStyle(write.querySelector('sup.md-footnote')).borderRadius,
            alertBefore: getComputedStyle(write.querySelector('.md-alert'), '::before').content,
            alertStyle: getComputedStyle(write.querySelector('.md-alert')).fontStyle,
            alertColors: [...write.querySelectorAll('.md-alert')].map(el => getComputedStyle(el).borderLeftColor),
            alertBackgrounds: [...write.querySelectorAll('.md-alert')].map(el => getComputedStyle(el).backgroundColor),
            alertTitleColors: [...write.querySelectorAll('.md-alert-text')].map(el => getComputedStyle(el).color),
          };
        });
        assert.equal(geometry.position, 'absolute', file);
        assert.equal(geometry.overflow, 'auto', file);
        assert.equal(geometry.moved, 500, file);
        assert(geometry.extraWidth <= 1, `${file} ${width}: overflow ${geometry.extraWidth}`);
        assert.equal(geometry.prePadding, '0px', file);
        assert.equal(geometry.preBorder, '0px', file);
        assert.equal(geometry.preBackground, 'rgba(0, 0, 0, 0)', file);
        assert.equal(geometry.fontSize, '16px', file);
        assert(geometry.strongWeight >= 600, `${file}: weak strong text`);
        const emphasisContrast = contrast(geometry.emphasisColor, geometry.canvas);
        assert(emphasisContrast >= 4.5, `${file}: low-contrast emphasis ${emphasisContrast.toFixed(2)}`);
        assert.notEqual(geometry.markBackground, 'rgb(255, 255, 0)', `${file}: default yellow mark`);
        const markContrast = contrast(geometry.markColor, geometry.markBackground);
        assert(markContrast >= 4.5, `${file}: low-contrast mark ${markContrast.toFixed(2)}`);
        assert.equal(geometry.kbdBorderBottom, '2px', `${file}: unstyled kbd`);
        assert.notEqual(geometry.footnoteRadius, '0px', `${file}: unstyled footnote`);
        assert.equal(geometry.alertBefore, 'none', `${file}: quote decoration leaked into alert`);
        assert.equal(geometry.alertStyle, 'normal', `${file}: italic quote style leaked into alert`);
        assert.equal(new Set(geometry.alertColors).size, 5, `${file}: alert types are indistinguishable`);
        assert.deepEqual(geometry.alertTitleColors, geometry.alertColors, `${file}: alert title and border disagree`);
        const alertContrasts = geometry.alertTitleColors.map((color, index) => contrast(color, geometry.alertBackgrounds[index]));
        assert(alertContrasts.every(value => value >= 4.5), `${file}: low-contrast alert title ${Math.min(...alertContrasts).toFixed(2)}`);
        assert.equal(geometry.taskMarker, 'none', file);
        assert(!geometry.ulMarker.includes('counter('), `${file}: mixed list has number`);
        assert.equal(geometry.ulMarkerPosition, 'absolute', `${file}: bullet on separate line`);
        assert.equal(geometry.ulMarkerTop, '14px', `${file}: bullet not centered on 28px line`);
        assert.equal(geometry.ulMarkerTranslate, '0px -50%', `${file}: bullet center offset missing`);
        const checkbox = page.locator('input[type=checkbox]').last();
        await checkbox.check();
        assert(await checkbox.isChecked(), file);
        await page.locator('#write > p').first().click();
        await page.keyboard.press('End');
        await page.keyboard.type(' EDIT-CHECK');
        assert((await page.locator('#write').innerText()).includes('EDIT-CHECK'), file);
        // Long unwrapped code must scroll inside CodeMirror, not the document.
        await page.locator('.CodeMirror-line').first().evaluate(el => { el.textContent = 'x'.repeat(600); });
        const codeScroll = await page.evaluate(() => {
          const cm = document.querySelector('.CodeMirror-scroll');
          cm.scrollLeft = 200;
          const content = document.querySelector('content');
          return [cm.scrollLeft, content.scrollWidth - content.clientWidth];
        });
        assert(codeScroll[0] > 0 && codeScroll[1] <= 1, `${file}: code scroll ${codeScroll}`);
        if (process.env.MD2CARD_SCREENSHOTS && width === 1200) {
          await page.locator('.CodeMirror-line').first().evaluate(el => { el.textContent = 'const value = 42;'; });
          await page.evaluate(() => { document.querySelector('content').scrollTop = 0; });
          await page.screenshot({ path: path.join(process.env.MD2CARD_SCREENSHOTS, file + '.png') });
        }
        report.push({ theme: file, width, ...geometry });
      }
    }
    // Exercise the real relative @import as well as the combined editor fixture.
    for (const file of themes) {
      const url = pathToFileURL(path.join(__dirname, 'audit.html'));
      url.searchParams.set('theme', file.slice(8, -4));
      await page.goto(url.href);
      assert.equal(await page.locator('#write > p').first().evaluate(el => getComputedStyle(el).fontSize), '16px');
      assert.equal(await page.locator('#write').evaluate(el => getComputedStyle(el).isolation), 'isolate');
    }
    console.log(`PASS: ${report.length} theme/viewport combinations; scroll, overflow, editable text, checkboxes, CodeMirror lines.`);
    if (process.env.MD2CARD_SCREENSHOTS) fs.writeFileSync(path.join(process.env.MD2CARD_SCREENSHOTS, 'checks.json'), JSON.stringify(report, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
