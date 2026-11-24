const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const port = Number(process.env.PORT) || 3000;
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon"
};

async function providerRequest(params) {
  const key = process.env.SERVICES_API_KEY;
  if (!key) {
    const error = new Error("مزود الأرقام غير مضبوط على الخادم.");
    error.statusCode = 503;
    throw error;
  }
  const url = new URL("https://servicesapi.tech/");
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { "X-API-Key": key, "Accept": "application/json" },
      signal: controller.signal
    });
    const data = await response.json().catch(() => null);
    if (!data || typeof data !== "object") {
      const error = new Error("استجابة غير مفهومة من مزود الأرقام.");
      error.statusCode = 502;
      throw error;
    }
    return { httpStatus: response.status, data };
  } catch (error) {
    if (error.name === "AbortError") {
      const timeoutError = new Error("انتهت مهلة الاتصال بمزود الأرقام.");
      timeoutError.statusCode = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  let parsed;
  try {
    parsed = new URL(req.url, "http://localhost");
  } catch {
    res.writeHead(400);
    return res.end("Bad request");
  }

  if (req.method === "GET" && parsed.pathname.startsWith("/api/")) {
    try {
      if (parsed.pathname === "/api/provider/health") {
        const result = await providerRequest({ action: "balance" });
        return sendJson(res, result.httpStatus, {
          status: result.data.status,
          connected: result.data.status === "ok",
          balance: result.data.status === "ok" ? result.data.balance : undefined,
          error: result.data.status === "error" ? result.data.code : undefined
        });
      }
      if (parsed.pathname === "/api/provider/countries") {
        const service = parsed.searchParams.get("service") || "tg";
        if (!["tg", "wa"].includes(service)) {
          return sendJson(res, 400, { status: "error", message: "الخدمة يجب أن تكون tg أو wa." });
        }
        const result = await providerRequest({ action: "available_countries", service });
        return sendJson(res, result.httpStatus, result.data);
      }
      return sendJson(res, 404, { status: "error", message: "المسار غير موجود." });
    } catch (error) {
      console.error("Provider API error:", error.message);
      return sendJson(res, error.statusCode || 502, {
        status: "error",
        message: error.statusCode === 503
          ? error.message
          : "تعذر الاتصال بمزود الأرقام حالياً."
      });
    }
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" });
    return res.end("Method not allowed");
  }

  let pathname;
  try {
    pathname = decodeURIComponent(parsed.pathname);
  } catch {
    res.writeHead(400);
    return res.end("Bad request");
  }

  if (pathname === "/") pathname = "/index.html";
  const file = path.resolve(root, "." + pathname);

  if (!file.startsWith(root + path.sep) && file !== path.join(root, "index.html")) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  fs.readFile(file, (error, data) => {
    if (error) {
      res.writeHead(error.code === "ENOENT" ? 404 : 500);
      return res.end(error.code === "ENOENT" ? "Not found" : "Server error");
    }
    res.writeHead(200, {
      "Content-Type": mime[path.extname(file).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff"
    });
    res.end(data);
  });
});

server.on("error", (error) => {
  console.error("HTTP server failed to start:", error);
  process.exit(1);
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Talabati Numbers server listening on 0.0.0.0:${port}`);
});
