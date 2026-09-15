const fs = require("fs");
const path = require("path");

const originalReadFileSync = fs.readFileSync.bind(fs);
const injectionPath = path.join(__dirname, "offline-mode-integration.js");

fs.readFileSync = function(filePath, options) {
  const result = originalReadFileSync(filePath, options);
  if (typeof filePath === "string" && path.resolve(filePath) === path.join(__dirname, "index.html") && typeof result === "string") {
    const script = originalReadFileSync(injectionPath, "utf8");
    const tag = `<script>\n${script}\n</script>`;
    return result.replace("</head>", `${tag}</head>`);
  }
  return result;
};

require("./server.js");
