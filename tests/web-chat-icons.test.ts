import { describe, expect, test } from "bun:test";
import { GitFork, type IconNode } from "lucide";
import { renderWebChatIcon } from "../src/web/chat/icons.js";

describe("Web Chat 图标", () => {
  test("将 Lucide 节点渲染为固定且隐藏于辅助技术的 SVG", () => {
    const html = renderWebChatIcon(GitFork);

    expect(html).toContain('class="button-icon"');
    expect(html).toContain('viewBox="0 0 24 24"');
    expect(html).toContain('stroke="currentColor"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('focusable="false"');
    expect(html).toContain("<circle");
    expect(html).toContain("<path");
  });

  test("转义 SVG 属性和类名中的特殊字符", () => {
    const icon = [["path", { d: '"><script>alert(1)</script>' }]] as IconNode;
    const html = renderWebChatIcon(icon, 'icon" onclick="alert(1)');

    expect(html).not.toContain("<script>");
    expect(html).not.toContain('onclick="alert(1)"');
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&quot;");
  });
});
