const fs = require("fs");
let html = fs.readFileSync("index.html", "utf8");

// 1. Fix the Sidebar Layout
html = html.replace(
  ".app-layout {\n        display: flex;\n        min-height: 100vh;\n      }",
  `.app-layout {
        display: flex;
        min-height: 100vh;
        position: relative;
      }`,
);

html = html.replace(
  /\.sidebar \{[\s\S]*?position: fixed;[\s\S]*?\}/,
  `.sidebar {
        width: 250px;
        min-width: 250px;
        background: var(--white);
        border-right: 1px solid var(--border);
        padding: 20px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        z-index: 50;
      }`,
);

html = html.replace(
  /\.main-content \{[\s\S]*?margin-left: 250px;[\s\S]*?\}/,
  `.main-content {
        flex: 1;
        padding: 20px;
        position: relative;
        min-width: 0;
      }`,
);

// Add mode classes to body
html = html.replace(
  "</style>",
  `
      body.mode-pera .qpc-only { display: none !important; }
      body.mode-qpc .pera-only { display: none !important; }
    </style>`,
);

// Update HTML sections to use the new classes instead of inline styles
html = html.replace(
  'id="builder-pera"',
  'id="builder-pera" class="section-block message-builder pera-only"',
);
html = html.replace(
  'class="section-block message-builder"\n            id="builder-qpc"\n            style="display: none"',
  'class="section-block message-builder qpc-only"\n            id="builder-qpc"',
);
html = html.replace(
  'id="theory-pera"',
  'id="theory-pera" class="section-block theory-block pera-only"',
);
html = html.replace(
  'class="section-block theory-block"\n            id="theory-qpc"\n            style="display: none"',
  'class="section-block theory-block qpc-only"\n            id="theory-qpc"',
);

// Update setMode JS
html = html.replace(
  /function setMode\(mode\) \{[\s\S]*?resetAnalysisUI\(\);/,
  `function setMode(mode) {
        currentMode = mode;
        document.body.className = "mode-" + mode;
        
        document.getElementById("nav-pera").classList.toggle("active", mode === "pera");
        document.getElementById("nav-qpc").classList.toggle("active", mode === "qpc");

        const title = document.getElementById("main-title");
        const desc = document.getElementById("main-desc");
        if (mode === "pera") {
          title.textContent = "PERA";
          desc.textContent = "Domina el arte de comunicar con eficacia e inspiracion";
        } else {
          title.textContent = "Piramide QPC";
          desc.textContent = "Destila tu mensaje ejecutivo (Que, Por que, Como)";
        }

        resetAnalysisUI();`,
);

fs.writeFileSync("index.html", html);
console.log("Replaced CSS and JS correctly");
