export const WEB_CHAT_MARKDOWN_SCRIPT = String.raw`
(function () {
  function appendInline(parent, input) {
    var pattern = /(\`[^\`]+\`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g;
    var cursor = 0;
    var match;
    while ((match = pattern.exec(input)) !== null) {
      if (match.index > cursor) {
        parent.append(document.createTextNode(input.slice(cursor, match.index)));
      }
      var token = match[0];
      if (token.startsWith("\`")) {
        var code = document.createElement("code");
        code.textContent = token.slice(1, -1);
        parent.append(code);
      } else if (token.startsWith("**")) {
        var strong = document.createElement("strong");
        strong.textContent = token.slice(2, -2);
        parent.append(strong);
      } else {
        var linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        var link = document.createElement("a");
        link.textContent = linkMatch ? linkMatch[1] : token;
        if (linkMatch) {
          try {
            var url = new URL(linkMatch[2], window.location.href);
            var protocol = url.protocol;
            if (protocol === "https:" || protocol === "http:" || protocol === "mailto:") {
              link.href = url.href;
              link.target = "_blank";
              link.rel = "noopener noreferrer";
            }
          } catch (_) {}
        }
        parent.append(link);
      }
      cursor = pattern.lastIndex;
    }
    if (cursor < input.length) {
      parent.append(document.createTextNode(input.slice(cursor)));
    }
  }

  function textBlock(tagName, text, className) {
    var node = document.createElement(tagName);
    if (className) node.className = className;
    appendInline(node, text);
    return node;
  }

  window.renderSafeMarkdown = function (target, markdown) {
    var fragment = document.createDocumentFragment();
    var lines = String(markdown || "").split(/\r?\n/);
    var paragraph = [];
    var list = null;
    var codeLines = null;
    var codeLanguage = "";

    function flushParagraph() {
      if (!paragraph.length) return;
      fragment.append(textBlock("p", paragraph.join("\n")));
      paragraph = [];
    }

    function flushList() {
      if (!list) return;
      fragment.append(list);
      list = null;
    }

    function flushCode() {
      if (!codeLines) return;
      var frame = document.createElement("div");
      frame.className = "code-block";
      var bar = document.createElement("div");
      bar.className = "code-bar";
      var language = document.createElement("span");
      language.textContent = codeLanguage || "code";
      var copy = document.createElement("button");
      copy.type = "button";
      copy.className = "icon-button small";
      copy.title = "复制代码";
      copy.setAttribute("aria-label", "复制代码");
      copy.textContent = "⧉";
      var code = document.createElement("code");
      code.textContent = codeLines.join("\n");
      copy.addEventListener("click", function () {
        navigator.clipboard.writeText(code.textContent || "").catch(function () {});
      });
      bar.append(language, copy);
      var pre = document.createElement("pre");
      pre.append(code);
      frame.append(bar, pre);
      fragment.append(frame);
      codeLines = null;
      codeLanguage = "";
    }

    lines.forEach(function (line) {
      var fence = line.match(/^\s*\`\`\`([a-zA-Z0-9_-]*)\s*$/);
      if (fence) {
        if (codeLines) flushCode();
        else {
          flushParagraph();
          flushList();
          codeLines = [];
          codeLanguage = fence[1] || "";
        }
        return;
      }
      if (codeLines) {
        codeLines.push(line);
        return;
      }
      if (!line.trim()) {
        flushParagraph();
        flushList();
        return;
      }
      var heading = line.match(/^(#{1,4})\s+(.+)$/);
      if (heading) {
        flushParagraph();
        flushList();
        fragment.append(textBlock("h" + heading[1].length, heading[2]));
        return;
      }
      var item = line.match(/^\s*[-*]\s+(.+)$/);
      if (item) {
        flushParagraph();
        if (!list) list = document.createElement("ul");
        list.append(textBlock("li", item[1]));
        return;
      }
      var quote = line.match(/^\s*>\s?(.+)$/);
      if (quote) {
        flushParagraph();
        flushList();
        fragment.append(textBlock("blockquote", quote[1]));
        return;
      }
      paragraph.push(line);
    });
    flushParagraph();
    flushList();
    flushCode();
    target.replaceChildren(fragment);
  };
})();
`;
