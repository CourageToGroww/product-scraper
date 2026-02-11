module.exports = {
  // Core
  HttpClient: require("./core/http-client"),
  get BrowserClient() { return require("./core/browser-client"); },
  get HybridClient() { return require("./core/hybrid-client"); },

  // Extractors
  CssExtractor: require("./extractors/css-extractor"),
  AutoParser: require("./extractors/auto-parser"),

  // Outputs
  JsonOutput: require("./outputs/json-output"),
  CsvOutput: require("./outputs/csv-output"),
  MarkdownOutput: require("./outputs/markdown-output"),
  TextOutput: require("./outputs/text-output"),
  get ScreenshotOutput() { return require("./outputs/screenshot-output"); },
  get PdfOutput() { return require("./outputs/pdf-output"); },

  // Anti-bot
  UserAgentRotator: require("./anti-bot/user-agent-rotator"),
  ProxyRotator: require("./anti-bot/proxy-rotator"),
  get CaptchaSolver() { return require("./anti-bot/captcha-solver"); },
  get AdaptiveBypass() { return require("./anti-bot/adaptive-bypass"); },
  get Geotargeting() { return require("./anti-bot/geotargeting"); },

  // Session
  get SessionManager() { return require("./core/session-manager"); },

  // Page interaction
  get JsInstructor() { return require("./core/js-instructor"); },
  get NetworkInterceptor() { return require("./core/network-interceptor"); },

  // Response conversion
  get ResponseConverter() { return require("./core/response-converter"); },

  // Scrapers
  GenericScraper: require("./scrapers/generic-scraper"),
  Page365Scraper: require("./scrapers/page365-scraper"),

  // Utils
  OutputManager: require("./utils/output-manager"),
  RateLimiter: require("./utils/rate-limiter"),
  ImageDownloader: require("./utils/image-downloader")
};
