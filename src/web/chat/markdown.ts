export const WEB_CHAT_MARKDOWN_SCRIPT = String.raw`
(function () {
  async function copyPlainText(value) {
    var text = String(value || "");
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch (_) {}
    }
    var textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.setAttribute("aria-hidden", "true");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    document.body.append(textarea);
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    var copied = false;
    try {
      copied = document.execCommand("copy");
    } catch (_) {
    } finally {
      textarea.remove();
    }
    if (!copied) throw new Error("复制失败，请手动选择文本复制。");
  }

  window.copyPlainText = copyPlainText;

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
        copyPlainText(code.textContent || "").catch(function () {});
      });
      bar.append(language, copy);
      var pre = document.createElement("pre");
      pre.append(code);
      frame.append(bar, pre);
      fragment.append(frame);
      codeLines = null;
      codeLanguage = "";
    }

    function splitTableRow(line) {
      var source = String(line || "").trim();
      if (source.startsWith("|")) source = source.slice(1);
      if (source.endsWith("|") && !source.endsWith("\\|")) source = source.slice(0, -1);
      var cells = [];
      var cell = "";
      var escaped = false;
      var inlineCode = false;
      for (var characterIndex = 0; characterIndex < source.length; characterIndex += 1) {
        var character = source[characterIndex];
        if (escaped) {
          cell += character === "|" ? "|" : "\\" + character;
          escaped = false;
          continue;
        }
        if (character === "\\") {
          escaped = true;
          continue;
        }
        if (character === String.fromCharCode(96)) {
          inlineCode = !inlineCode;
          cell += character;
          continue;
        }
        if (character === "|" && !inlineCode) {
          cells.push(cell.trim());
          cell = "";
          continue;
        }
        cell += character;
      }
      if (escaped) cell += "\\";
      cells.push(cell.trim());
      return cells;
    }

    function isTableDelimiter(cells) {
      return cells.length > 0 && cells.every(function (cell) {
        return /^:?-{3,}:?$/.test(cell);
      });
    }

    function tableAlignment(delimiter) {
      if (delimiter.startsWith(":") && delimiter.endsWith(":")) return "center";
      if (delimiter.endsWith(":")) return "right";
      return "left";
    }

    function createTable(headerCells, delimiterCells, rows) {
      var wrapper = document.createElement("div");
      wrapper.className = "markdown-table-wrap";
      var table = document.createElement("table");
      var head = document.createElement("thead");
      var headRow = document.createElement("tr");
      headerCells.forEach(function (value, columnIndex) {
        var cell = document.createElement("th");
        cell.className = "align-" + tableAlignment(delimiterCells[columnIndex]);
        appendInline(cell, value);
        headRow.append(cell);
      });
      head.append(headRow);
      var body = document.createElement("tbody");
      rows.forEach(function (values) {
        var row = document.createElement("tr");
        headerCells.forEach(function (_header, columnIndex) {
          var cell = document.createElement("td");
          cell.className = "align-" + tableAlignment(delimiterCells[columnIndex]);
          appendInline(cell, values[columnIndex] || "");
          row.append(cell);
        });
        body.append(row);
      });
      table.append(head, body);
      wrapper.append(table);
      return wrapper;
    }

    for (var lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      var line = lines[lineIndex];
      var fence = line.match(/^\s*\`\`\`([a-zA-Z0-9_-]*)\s*$/);
      if (fence) {
        if (codeLines) flushCode();
        else {
          flushParagraph();
          flushList();
          codeLines = [];
          codeLanguage = fence[1] || "";
        }
        continue;
      }
      if (codeLines) {
        codeLines.push(line);
        continue;
      }
      if (!line.trim()) {
        flushParagraph();
        flushList();
        continue;
      }
      if (line.includes("|") && lineIndex + 1 < lines.length) {
        var headerCells = splitTableRow(line);
        var delimiterCells = splitTableRow(lines[lineIndex + 1]);
        if (
          headerCells.length === delimiterCells.length &&
          isTableDelimiter(delimiterCells)
        ) {
          flushParagraph();
          flushList();
          var rows = [];
          var rowIndex = lineIndex + 2;
          while (
            rowIndex < lines.length &&
            lines[rowIndex].trim() &&
            lines[rowIndex].includes("|")
          ) {
            rows.push(splitTableRow(lines[rowIndex]));
            rowIndex += 1;
          }
          fragment.append(createTable(headerCells, delimiterCells, rows));
          lineIndex = rowIndex - 1;
          continue;
        }
      }
      var heading = line.match(/^(#{1,4})\s+(.+)$/);
      if (heading) {
        flushParagraph();
        flushList();
        fragment.append(textBlock("h" + heading[1].length, heading[2]));
        continue;
      }
      var item = line.match(/^\s*[-*]\s+(.+)$/);
      if (item) {
        flushParagraph();
        if (!list) list = document.createElement("ul");
        list.append(textBlock("li", item[1]));
        continue;
      }
      var quote = line.match(/^\s*>\s?(.+)$/);
      if (quote) {
        flushParagraph();
        flushList();
        fragment.append(textBlock("blockquote", quote[1]));
        continue;
      }
      paragraph.push(line);
    }
    flushParagraph();
    flushList();
    flushCode();
    target.replaceChildren(fragment);
  };
})();
`;
