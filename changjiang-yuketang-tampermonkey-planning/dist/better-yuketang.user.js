// ==UserScript==
// @name         BetterYuKeTang
// @namespace    https://github.com/jiaqiaosu/BetterYuKeTang
// @version      0.1.0
// @description  Enhance the Changjiang YukeTang learning flow with safer page helpers.
// @author       jiaqiaosu
// @match        *://*.yuketang.cn/*
// @match        *://changjiang.yuketang.cn/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// ==/UserScript==
(function bootstrap() {
  "use strict";

  const VERSION = "0.1.0";
  const STORAGE_KEY = "better-yuketang:settings";

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

  function inferTeacherFromText(text, courseName) {
    const normalizedText = getCleanText(text);
    if (!normalizedText) {
      return "";
    }

    const segments = normalizedText
      .split(/\n|[|｜/]/)
      .map((segment) => getCleanText(segment))
      .filter(Boolean);

    const teacherSegment = segments.find((segment) => {
      return (
        segment !== courseName &&
        !/我的课程|我听的课|课程|班级|进入|继续学习|开课|学期|课程班/.test(segment)
      );
    });

    if (!teacherSegment) {
      return "";
    }

    return teacherSegment.replace(/^(授课教师|教师|老师|主讲教师|主讲)\s*[:：]?\s*/i, "");
  }

  function extractCoursesFromPage() {
    const sectionSelectors = [
      '[class*="course"]',
      '[class*="Course"]',
      '[data-name*="course"]',
      '[data-name*="Course"]'
    ];
    const cardSelectors = [
      '[class*="course-card"]',
      '[class*="CourseCard"]',
      '[class*="courseCard"]',
      '[class*="card"]',
      'a[href*="/course/"]',
      'a[href*="/lesson/"]'
    ];
    const titleSelectors = [
      '[class*="course-name"]',
      '[class*="CourseName"]',
      '[class*="title"]',
      '[class*="Title"]',
      'h3',
      'h4'
    ];
    const teacherSelectors = [
      '[class*="teacher"]',
      '[class*="Teacher"]',
      '[class*="lecturer"]',
      '[class*="Lecturer"]',
      '[class*="instructor"]',
      '[class*="Instructor"]',
      '[class*="name"]'
    ];

    const section = Array.from(document.querySelectorAll("section, div, main")).find((node) => {
      const text = getCleanText(node.textContent);
      if (!/我听的课/.test(text)) {
        return false;
      }

      return sectionSelectors.some((selector) => node.querySelector(selector));
    });

    const searchRoot = section || document.body;
    const cards = uniqueBy(
      Array.from(searchRoot.querySelectorAll(cardSelectors.join(","))).filter((element) => {
        const text = getCleanText(element.textContent);
        return text && /课程|老师|教师|主讲|进入|学习/.test(text);
      }),
      (element) => element
    );

    const courses = cards
      .map((card) => {
        const courseName = findText(card, titleSelectors);
        const teacher = findText(card, teacherSelectors) || inferTeacherFromText(card.textContent, courseName);

        if (!courseName) {
          return null;
        }

        return {
          courseName,
          teacher: teacher || "未识别到教师信息"
        };
      })
      .filter(Boolean);

    return uniqueBy(courses, (item) => `${item.courseName}::${item.teacher}`);
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

      .byt-list li + li {
        margin-top: 4px;
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
            <ul class="byt-list">
              ${
                courseSnapshot.courses.length
                  ? courseSnapshot.courses
                      .map(
                        (item) =>
                          `<li>${item.courseName} ${item.teacher ? `- ${item.teacher}` : ""}</li>`
                      )
                      .join("")
                  : `<li>${courseSnapshot.message}</li>`
              }
            </ul>
          </section>
          `
              : ""
          }
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
      return { courses: [], message: "当前页面不是课程列表页" };
    }

    const courses = extractCoursesFromPage();
    logger.info("Collected course snapshot", courses);

    if (!courses.length) {
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
    const courseSnapshot = collectPageData(context, logger);
    logger.info("Bootstrapping userscript", { context, settings });
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

