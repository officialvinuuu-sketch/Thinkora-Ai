const fs = require("fs");
const path = require("path");

const originalReadFileSync = fs.readFileSync.bind(fs);
const integrationPath = path.join(__dirname, "offline-mode-integration.js");
const integration = originalReadFileSync(integrationPath, "utf8");

fs.readFileSync = function(filePath, options) {
  const result = originalReadFileSync(filePath, options);
  const encoding = typeof options === "string" ? options : options && options.encoding;
  const target = typeof filePath === "string" ? filePath : (filePath && filePath.toString ? filePath.toString() : "");
  if (encoding === "utf8" && path.basename(target) === "index.html" && typeof result === "string") {
    const injected = `<script>\n${integration}\n</script>`;
    return result.includes("id=\"thinkoraModelRow\"") ? result : result.replace("</head>", `${injected}</head>`);
  }
  return result;
};
