"""Extract MD2Card's public card CSS and adapt it to Typora."""

from __future__ import annotations

import ast
import re
import sys
from pathlib import Path


THEMES = {
    "bytedance": "字节范",
    "alibaba": "阿里橙",
    "art-deco": "艺术装饰",
    "glassmorphism": "玻璃拟态",
    "warm": "温暖柔和",
    "minimal": "简约高级灰",
    "minimalist": "极简黑白",
    "dreamy": "梦幻渐变",
    "nature": "清新自然",
    "xiaohongshu": "紫色小红书",
    "notebook": "笔记本",
    "business": "商务简报",
    "japanese-magazine": "日本杂志",
}


def js_string_after(source: str, start: int) -> str:
    pos = source.index("css:", start) + 4
    quote = source[pos]
    if quote not in "\"'":
        raise ValueError("css is not a quoted string")
    end = pos + 1
    escaped = False
    while end < len(source):
        char = source[end]
        if char == quote and not escaped:
            value = ast.literal_eval(source[pos : end + 1])
            return value.encode("utf-16", "surrogatepass").decode("utf-16")
        escaped = char == "\\" and not escaped
        if char != "\\":
            escaped = False
        end += 1
    raise ValueError("unterminated css string")


def matching_brace(css: str, opening: int) -> int:
    depth = 0
    quote = None
    escaped = False
    for pos in range(opening, len(css)):
        char = css[pos]
        if quote:
            if char == quote and not escaped:
                quote = None
            escaped = char == "\\" and not escaped
            if char != "\\":
                escaped = False
        elif char in "\"'":
            quote = char
        elif char == "{":
            depth += 1
        elif char == "}" and depth == 1:
            return pos
        elif char == "}":
            depth -= 1
    raise ValueError("unbalanced css")


def card_rules(css: str, theme_id: str) -> str:
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    rules = []
    pos = 0
    needle = f".card-{theme_id}"
    while True:
        opening = css.find("{", pos)
        if opening < 0:
            break
        header = css[pos:opening].strip()
        closing = matching_brace(css, opening)
        body = css[opening + 1 : closing].strip()
        if header.startswith(("@media", "@supports")):
            rules.append(f"{header} {{\n{card_rules(body, theme_id)}\n}}")
        elif needle in header and ".card-cover-" not in header:
            # Card wrappers are not Typora's scrolling <content> element.
            # Only the outer decoration survives: three wrappers cannot share
            # the same two pseudo-elements without painting over editable text.
            if re.fullmatch(re.escape(needle) + r"\s+\.card-content(?:-inner)?:{1,2}(before|after)", header):
                pos = closing + 1
                continue
            header = header.replace(needle + " .card-content-inner", "#write")
            header = header.replace(needle + " .card-content", "#write")
            header = header.replace(needle, "#write")
            if re.search(r"\.[a-zA-Z]", header):
                pos = closing + 1
                continue  # Website-only headers, footers and showcase widgets.
            if "attr(data-text)" in body or re.search(r"\bpre:{1,2}", header):
                pos = closing + 1
                continue
            header = header.replace("code:not(pre code)", "code:not(.md-fences code):not(.md-meta-block code)")
            header = re.sub(r"\bpre\b", ":is(.md-fences, pre.md-meta-block)", header)
            header = re.sub(r"\b(ol|ul)\s+li\b", r"\1 > li", header)
            body = body.replace('"0" attr(data-index)', "counter(list-item)")
            body = body.replace("attr(data-index)", "counter(list-item)")
            body = body.replace("border: 1 solid", "border: 1px solid")
            # Remove card sizing at the source, not with overflow/height !important.
            remove = ["backdrop-filter", "-webkit-backdrop-filter", "counter-increment", "counter-reset", "transition"]
            if header == "#write":
                remove += ["width", "height", "min-height", "max-height", "padding", "margin", "position", "z-index", "overflow", "transform", "box-shadow"]
                body = re.sub(r"(?m)^\s*background:\s*transparent;", "", body)
            if re.search(r"\bimg\b|:hover", header):
                remove += ["transform"]
            body = re.sub(r"(?m)^\s*(?:" + "|".join(remove) + r")\s*:[^;]+;", "", body)
            if re.search(r":{1,2}(before|after)", header):
                body += "\n  pointer-events: none;"
            if re.fullmatch(r"#write:{1,2}(before|after)", header):
                # Decorative layers must stay behind text and inside the paper.
                body = re.sub(r"(top|right|bottom|left):\s*calc\(var\(--spacing\)\s*\*\s*-[\d.]+\)", r"\1: 0", body)
                if not re.search(r"(?:top|bottom):", body):
                    body += "\n  top: 0;"
                if not re.search(r"(?:left|right):", body):
                    body += "\n  left: 0;"
                body += "\n  z-index: -1;"
            if body.strip():
                rules.append(f"{header} {{\n  {body.strip()}\n}}")
        pos = closing + 1
    return "\n\n".join(rules)


def root_property(css: str, theme_id: str, name: str, fallback: str) -> str:
    match = re.search(rf"\.card-{re.escape(theme_id)}\s*\{{(.*?)\}}", css, re.S)
    if not match:
        return fallback
    prop = re.search(rf"(?:^|;)\s*{re.escape(name)}\s*:\s*(.*?);", match.group(1), re.S)
    return " ".join(prop.group(1).split()) if prop else fallback


def build(source_path: Path, output_dir: Path) -> None:
    source = source_path.read_text(encoding="utf-8")
    for theme_id, title in THEMES.items():
        marker = f'id:"{theme_id}",thumbnail:'
        start = source.find(marker)
        if start < 0:
            raise ValueError(f"theme not found: {theme_id}")
        original = js_string_after(source, start)
        adapted = card_rules(original, theme_id)
        background = root_property(original, theme_id, "background", root_property(original, theme_id, "background-color", "#fff"))
        accent = root_property(original, theme_id, "--highlight-color", "#555")
        dark = theme_id in ("art-deco", "glassmorphism")
        # Keep pastel fills, but use darker ink of the same hue for reading.
        ink = {
            "bytedance": {"#fa2c19": "#b82717"},
            "alibaba": {"#ff6a00": "#b94c00"},
            "notebook": {"#3498db": "#176eac", "#7f8c8d": "#5d696b", "#e74c3c": "#be3628"},
            "warm": {"#ff7e4f": "#b84720", "#ff9d7c": "#ad492a"},
            "dreamy": {"#5e6fff": "#4857bd", "#8c9eff": "#5363b8", "#7c8dff": "#5363b8"},
            "nature": {"#4caf50": "#2d7433", "#81c784": "#39793d"},
        }.get(theme_id, {})
        for pale, readable in ink.items():
            adapted = re.sub(r"(?m)(^\s*color:\s*)" + pale + r"\b", r"\g<1>" + readable, adapted)
        text_accent = ink.get(accent, accent)
        shell = "#161616" if dark else "#f7f7f8"
        if theme_id == "xiaohongshu":
            shell = "#8863cf"
        extra = {
            "bytedance": "#write { border-top: 4px solid #1677ff; border-image: linear-gradient(90deg,#1677ff,#05d4cd,#ff4d4f) 1; } #write h2 { background: linear-gradient(135deg,#1677ff,#008d91); }",
            "alibaba": "#write { border-top: 4px solid #ff6a00; } #write h2 { background: linear-gradient(135deg,#cf5500,#bd6400); } #write ol > li::before { background: #b94c00; }",
            "warm": "#write ol > li::before { color: #602511; }",
            "dreamy": "#write ol > li::before { color: #202858; }",
            "nature": "#write ol > li::before { color: #234d27; }",
            "business": "#write { border-top: 4px solid #3b82f6; }",
            "art-deco": "#write#write { padding-top: 5rem; padding-bottom: 5rem; }",
            "glassmorphism": """#write {
  background: radial-gradient(circle at 50px 50px, #283b53 0, transparent 180px),
              radial-gradient(circle at 90% 98%, #4c2846 0, transparent 160px), #292929;
}
#write::before, #write::after { content: none; }
#write ul { display: block; }
#write ul > li { background: transparent; border: 0; box-shadow: none; }
#write ul > li::before { display: block; content: "•"; color: #4facfe; }
""",
            "xiaohongshu": """#write { background: #fff; box-shadow: 8px 8px 0 #ca6ce5, 10px 10px 0 #222; }
#write::before, #write::after { content: none; }
#write h1 { text-shadow: -1px -1px 0 #523177, 1px -1px 0 #523177, -1px 1px 0 #523177, 1px 1px 0 #523177; }
""",
            "notebook": "#write { background-image: repeating-linear-gradient(transparent 0, transparent 27px, #edf1f4 27px, #edf1f4 28px); background-size: 100% 28px; } @media (max-width:720px) { #write::before { left: .55rem; } }",
            "japanese-magazine": "#write::before { width: 32px; height: 32px; transform: none; clip-path: polygon(0 0,100% 0,0 100%); }",
        }.get(theme_id, "")
        result = f'''/* MD2Card · {title}
 * Source: https://md2card.cn/zh/editor
 * Adapted for Typora; generated by md2card/build_themes.py.
 */
@import "./md2card/base.css";

:root {{
  --md2card-page-background: {background};
  --md2card-accent: {accent};
  --md2card-link: {text_accent};
  --md2card-shell: {shell};
  --md2card-ink: {"#ececec" if dark else "#333"};
  --md2card-muted: {"#b4b8c0" if dark else "#68707b"};
  --md2card-panel: {"#242424" if dark else "#f5f6f8"};
  --md2card-border: {"#555" if dark else "#d9dde3"};
  --md2card-selection: {"#415771" if dark else "#d7e5fa"};
  --md2card-code-keyword: {"#c5a5f5" if dark else "#7140a2"};
  --md2card-code-string: {"#9bd29a" if dark else "#286b38"};
  --md2card-code-number: {"#f0ba87" if dark else "#9a451b"};
  color-scheme: {"dark" if dark else "light"};
}}

{adapted}

/* Small theme-specific adaptations; editing geometry lives in base.css. */
{extra}
'''
        target = output_dir / f"md2card-{theme_id}.css"
        target.write_text(result, encoding="utf-8", newline="\n")
        if " h1" not in result or ".card-content-inner" in result:
            raise ValueError(f"incomplete Typora selector adaptation: {theme_id}")


if __name__ == "__main__":
    if sys.argv[1:] == ["--check"]:
        # A small regression check for the shared conversion, no network needed.
        sample = '''.card-test {\n height: 100px;\n background: #fff;\n}
        .card-test .card-content-inner {\n transform: translate(10px, 10px);\n}
        .card-test ol li:before { content: attr(data-index); }
        .card-test pre { background: #eee; }
        .card-test code:not(pre code) { color: red; }
        .card-test .card-content-inner::before { content: "overlay"; }
        .card-test .card-content h1::after { content: "decoration"; }
        .card-test .card-footer { color: red; }
        @media (max-width: 600px) { .card-test h1 { font-size: 20px; } }'''
        converted = card_rules(sample, "test")
        assert "#write ol > li:before" in converted and "counter(list-item)" in converted
        assert "#write :is(.md-fences, pre.md-meta-block)" in converted
        assert "code:not(.md-fences code):not(.md-meta-block code)" in converted
        assert "#write h1" in converted
        assert 'content: "decoration"' in converted
        assert not any(x in converted for x in ("100px", "translate", "overlay", ".card-", "data-index"))
        assert js_string_after('css:"a{content:\\"}\\";}"', 0) == 'a{content:"}";}'
        print("Generator regression check passed")
        raise SystemExit(0)
    if len(sys.argv) != 2:
        raise SystemExit("usage: build_themes.py <MD2Card theme JS chunk>")
    build(Path(sys.argv[1]), Path(__file__).resolve().parent.parent)
