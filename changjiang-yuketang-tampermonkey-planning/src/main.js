(function bootstrap() {
  "use strict";

  const VERSION = "0.1.0";
  const STORAGE_KEY = "better-yuketang:settings";
  const MAX_LOG_ENTRIES = 80;
  const runtimeState = {
    logs: []
  };

  function createStorage() {
    const hasGMStorage =
      typeof GM_getValue === "function" && typeof GM_setValue === "function";

    return {
      get(defaultValue) {
        if (hasGMStorage) {
          return GM_getValue(STORAGE_KEY, defaultValue);
        }

        const rawValue = window.localStorage.getItem(STORAGE_KEY);
        if (!rawValue) {
          return defaultValue;
        }

        try {
          return JSON.parse(rawValue);
        } catch (_error) {
          return defaultValue;
        }
      },
      set(value) {
        if (hasGMStorage) {
          GM_setValue(STORAGE_KEY, value);
          return;
        }

        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
      }
    };
  }

  function createLogger(enabled) {
    const prefix = "[BetterYuKeTang]";

    function format(level, message, extra) {
      const entry = {
        level,
        message,
        extra: typeof extra === "undefined" ? null : extra,
        timestamp: new Date().toLocaleTimeString("zh-CN", { hour12: false })
      };

      runtimeState.logs.push(entry);
      if (runtimeState.logs.length > MAX_LOG_ENTRIES) {
        runtimeState.logs.shift();
      }

      if (!enabled && level === "debug") {
        return;
      }

      const method = level === "error" ? "error" : "log";
      if (typeof extra === "undefined") {
        console[method](`${prefix} ${message}`);
      } else {
        console[method](`${prefix} ${message}`, extra);
      }
    }

    return {
      debug(message, extra) {
        format("debug", message, extra);
      },
      info(message, extra) {
        format("info", message, extra);
      },
      error(message, extra) {
        format("error", message, extra);
      }
    };
  }

  function detectPageContext(url, title) {
    const href = String(url || "");
    const lowerTitle = String(title || "").toLowerCase();

    if (/\/pro\/courselist(?:[/?#]|$)/.test(href) || /courselist/.test(href)) {
      return { pageType: "course-list", confidence: "high" };
    }

    if (/course|classroom|lesson/.test(href) && /course|课程/.test(lowerTitle)) {
      return { pageType: "course-list", confidence: "medium" };
    }

    if (/ppt|slide|preview|lesson/.test(href)) {
      return { pageType: "ppt-reader", confidence: "low" };
    }

    if (/homework|exercise|assignment/.test(href)) {
      return { pageType: "assignment", confidence: "medium" };
    }

    return { pageType: "unknown", confidence: "low" };
  }

  function getCleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function uniqueBy(items, getKey) {
    const result = [];
    const seen = new Set();

    items.forEach((item) => {
      const key = getKey(item);
      if (!key || seen.has(key)) {
        return;
      }

      seen.add(key);
      result.push(item);
    });

    return result;
  }

  function findText(root, selectors) {
    for (const selector of selectors) {
      const element = root.querySelector(selector);
      const text = getCleanText(element && element.textContent);
      if (text) {
        return text;
      }
    }

    return "";
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function isVisibleElement(element) {
    if (!element || !(element instanceof HTMLElement)) {
      return false;
    }

    const style = window.getComputedStyle(element);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      Number(style.opacity || 1) === 0
    ) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    return rect.width >= 220 && rect.height >= 100;
  }

  function extractTextLinesFromCard(card) {
    return Array.from(card.querySelectorAll("div, span, p, h1, h2, h3, h4, h5, h6"))
      .map((node) => getCleanText(node.textContent))
      .filter(Boolean)
      .filter((text, index, list) => list.indexOf(text) === index)
      .filter((text) => !/^\.\.\.$|搜索课程|我的课|我的归档$/.test(text));
  }

  function normalizeCourseName(value) {
    const text = getCleanText(value).replace(/\s*归档$/, "");
    const semesterMatch = text.match(/^(.*?\d{4}[春秋])(?:-.+)?$/);

    if (semesterMatch) {
      return getCleanText(semesterMatch[1]);
    }

    return text;
  }

  function resolveCourseInfoFromCard(card) {
    const textLines = extractTextLinesFromCard(card);
    if (!textLines.length) {
      return null;
    }

    const rawCourseName =
      textLines.find((line) => line.length >= 4 && !/^\d{4}[春秋]-/.test(line)) || textLines[0];
    const courseName = normalizeCourseName(rawCourseName);
    const classInfo =
      textLines.find((line) => line !== rawCourseName && /春|秋|班|学院|专业|临班|\d{4}/.test(line)) ||
      textLines.find((line) => line !== rawCourseName) ||
      "";

    if (!courseName || courseName.length < 2) {
      return null;
    }

    return {
      courseName,
      classInfo
    };
  }

  function extractCoursesFromPage(logger) {
    const root =
      Array.from(document.querySelectorAll("main, section, div")).find((node) => {
        const text = getCleanText(node.textContent);
        return /我的课/.test(text) && !/搜索课程/.test(text);
      }) || document.body;

    const candidates = Array.from(root.querySelectorAll("a, div, article, li")).filter((element) => {
      if (!isVisibleElement(element)) {
        return false;
      }

      const text = getCleanText(element.textContent);
      if (!text || text.length > 200) {
        return false;
      }

      if (/搜索课程|教学管理|我的归档|我的课$/.test(text)) {
        return false;
      }

      return /春|秋|班|课程|学院|专业|临班|\d{4}/.test(text);
    });
    logger.debug("Candidate card count", { count: candidates.length });

    const courses = candidates
      .map((card) => resolveCourseInfoFromCard(card))
      .filter(Boolean)
      .filter((item) => item.classInfo);

    logger.debug("Parsed course count", { count: courses.length });

    return uniqueBy(courses, (item) => `${item.courseName}::${item.classInfo}`);
  }

  function injectStyles() {
    if (document.querySelector("#byt-style")) {
      return;
    }

    const css = `
      #byt-root {
        position: fixed;
        top: 16px;
        right: 16px;
        z-index: 2147483647;
        width: 320px;
        font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: #0f172a;
      }

      .byt-panel {
        border: 1px solid rgba(15, 23, 42, 0.1);
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.96);
        box-shadow: 0 20px 40px rgba(15, 23, 42, 0.15);
        backdrop-filter: blur(10px);
        overflow: hidden;
      }

      .byt-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 14px;
        background: linear-gradient(135deg, #f8fafc, #dbeafe);
        border-bottom: 1px solid rgba(15, 23, 42, 0.08);
      }

      .byt-title {
        font-size: 14px;
        font-weight: 700;
      }

      .byt-version {
        font-size: 12px;
        color: #475569;
      }

      .byt-body {
        padding: 14px;
      }

      .byt-status {
        margin: 0 0 12px;
        padding: 10px 12px;
        border-radius: 12px;
        background: #f8fafc;
        color: #334155;
      }

      .byt-section {
        margin-top: 12px;
      }

      .byt-section h3 {
        margin: 0 0 8px;
        font-size: 13px;
      }

      .byt-list {
        margin: 0;
        padding-left: 18px;
        color: #475569;
      }

      .byt-list-scrollable {
        max-height: 220px;
        overflow-y: auto;
        padding-right: 6px;
      }

      .byt-list li + li {
        margin-top: 4px;
      }

      .byt-meta {
        display: block;
        margin-top: 2px;
        font-size: 12px;
        color: #64748b;
      }

      .byt-log-list {
        margin: 0;
        padding-left: 0;
        list-style: none;
        max-height: 180px;
        overflow: auto;
      }

      .byt-log-item {
        padding: 6px 8px;
        border-radius: 10px;
        background: #f8fafc;
        color: #334155;
        font-size: 12px;
      }

      .byt-log-item + .byt-log-item {
        margin-top: 6px;
      }

      .byt-log-meta {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 2px;
        color: #64748b;
      }

      .byt-log-level {
        font-weight: 700;
        text-transform: uppercase;
      }

      .byt-actions {
        display: flex;
        gap: 8px;
        margin-top: 14px;
      }

      .byt-button {
        border: 0;
        border-radius: 10px;
        padding: 8px 10px;
        font-size: 12px;
        cursor: pointer;
        background: #0f172a;
        color: #fff;
      }

      .byt-button[data-variant="secondary"] {
        background: #e2e8f0;
        color: #0f172a;
      }
    `;

    if (typeof GM_addStyle === "function") {
      GM_addStyle(css);
      return;
    }

    const style = document.createElement("style");
    style.id = "byt-style";
    style.textContent = css;
    document.head.append(style);
  }

  function renderPanel({ context, settings, logger, courseSnapshot }) {
    let root = document.querySelector("#byt-root");
    if (!root) {
      root = document.createElement("div");
      root.id = "byt-root";
      document.body.append(root);
    }

    const enabledModules = [
      settings.enableCourseDashboard ? "课程看板" : null,
      settings.enablePptHelper ? "PPT 辅助" : null,
      settings.enableExportHelper ? "导出辅助" : null
    ].filter(Boolean);
    const logItems = runtimeState.logs
      .slice(-12)
      .reverse()
      .map((entry) => {
        const detail =
          entry.extra === null ? "" : ` ${escapeHtml(JSON.stringify(entry.extra))}`;

        return `
          <li class="byt-log-item">
            <div class="byt-log-meta">
              <span class="byt-log-level">${escapeHtml(entry.level)}</span>
              <span>${escapeHtml(entry.timestamp)}</span>
            </div>
            <div>${escapeHtml(entry.message)}${detail}</div>
          </li>
        `;
      })
      .join("");

    root.innerHTML = `
      <section class="byt-panel">
        <header class="byt-header">
          <div>
            <div class="byt-title">BetterYuKeTang</div>
            <div class="byt-version">v${VERSION}</div>
          </div>
          <div class="byt-version">${context.pageType}</div>
        </header>
        <div class="byt-body">
          <div class="byt-status">
            页面识别结果：<strong>${context.pageType}</strong><br />
            识别置信度：<strong>${context.confidence}</strong>
          </div>
          <section class="byt-section">
            <h3>已启用模块</h3>
            <ul class="byt-list">
              ${
                enabledModules.length
                  ? enabledModules.map((item) => `<li>${item}</li>`).join("")
                  : "<li>暂无启用模块</li>"
              }
            </ul>
          </section>
          ${
            context.pageType === "course-list"
              ? `
          <section class="byt-section">
            <h3>我听的课</h3>
            <ul class="byt-list byt-list-scrollable">
              ${
                courseSnapshot.courses.length
                  ? courseSnapshot.courses
                      .map(
                        (item) =>
                          `<li>
                            ${escapeHtml(item.courseName)}
                            <span class="byt-meta">${escapeHtml(
                              item.classInfo || "未识别到班级信息"
                            )}</span>
                          </li>`
                      )
                      .join("")
                  : `<li>${escapeHtml(courseSnapshot.message)}</li>`
              }
            </ul>
          </section>
          `
              : ""
          }
          <section class="byt-section">
            <h3>运行日志</h3>
            <ul class="byt-log-list">
              ${logItems || "<li class=\"byt-log-item\">暂无日志</li>"}
            </ul>
          </section>
          <section class="byt-section">
            <h3>下一步接入点</h3>
            <ul class="byt-list">
              <li>课程列表识别与聚合</li>
              <li>PPT 阅读状态识别</li>
              <li>打印入口检测与导出提示</li>
            </ul>
          </section>
          <div class="byt-actions">
            <button class="byt-button" data-action="toggle-debug">
              ${settings.debug ? "关闭调试" : "开启调试"}
            </button>
            <button class="byt-button" data-action="refresh" data-variant="secondary">
              重新识别
            </button>
          </div>
        </div>
      </section>
    `;

    root.querySelector('[data-action="toggle-debug"]').addEventListener("click", () => {
      const nextSettings = { ...settings, debug: !settings.debug };
      persistence.set(nextSettings);
      logger.info("Updated debug setting", nextSettings);
      start();
    });

    root.querySelector('[data-action="refresh"]').addEventListener("click", () => {
      logger.info("Manual refresh requested");
      start();
    });
  }

  function watchRouteChanges(onChange) {
    let previousUrl = window.location.href;
    const observer = new MutationObserver(() => {
      const currentUrl = window.location.href;
      if (currentUrl === previousUrl) {
        return;
      }

      previousUrl = currentUrl;
      onChange(currentUrl);
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  const defaults = {
    debug: false,
    enableCourseDashboard: true,
    enablePptHelper: true,
    enableExportHelper: true
  };

  const persistence = createStorage();

  function collectPageData(context, logger) {
    if (context.pageType !== "course-list") {
      logger.info("Skip course collection: current page is not a course list page");
      return { courses: [], message: "当前页面不是课程列表页" };
    }

    logger.info("Start collecting course cards from course list page");
    const courses = extractCoursesFromPage(logger);
    logger.info("Collected course snapshot", {
      count: courses.length,
      courses
    });

    if (!courses.length) {
      logger.error("No course cards were extracted from the current page");
      return {
        courses,
        message: "暂未识别到“我听的课”列表，可能需要等页面内容加载完成"
      };
    }

    return {
      courses,
      message: ""
    };
  }

  function start() {
    const settings = { ...defaults, ...persistence.get(defaults) };
    const logger = createLogger(settings.debug);
    const context = detectPageContext(window.location.href, document.title);
    logger.info("Bootstrapping userscript", {
      url: window.location.href,
      title: document.title,
      context,
      settings
    });
    const courseSnapshot = collectPageData(context, logger);
    injectStyles();
    renderPanel({ context, settings, logger, courseSnapshot });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }

  watchRouteChanges(() => {
    start();
  });
})();
