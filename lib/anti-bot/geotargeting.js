/**
 * Geotargeting — Rewrites proxy URLs with country targeting for major proxy providers.
 *
 * Supports URL-based country insertion for:
 * - BrightData (Luminati): Add -country-XX to username
 * - Oxylabs: Add -cc-XX to username
 * - SmartProxy: Add -cc-XX to username
 * - IPRoyal: Add -country-XX to username
 * - Generic: Appends country param to URL
 *
 * Usage: new Geotargeting("us").rewriteProxy("http://user:pass@proxy.brightdata.com:22225")
 */

const COUNTRY_CODES = new Set([
  "af","al","dz","ad","ao","ag","ar","am","au","at","az","bs","bh","bd","bb","by",
  "be","bz","bj","bt","bo","ba","bw","br","bn","bg","bf","bi","kh","cm","ca","cv",
  "cf","td","cl","cn","co","km","cg","cd","cr","ci","hr","cu","cy","cz","dk","dj",
  "dm","do","ec","eg","sv","gq","er","ee","sz","et","fj","fi","fr","ga","gm","ge",
  "de","gh","gr","gd","gt","gn","gw","gy","ht","hn","hu","is","in","id","ir","iq",
  "ie","il","it","jm","jp","jo","kz","ke","ki","kp","kr","kw","kg","la","lv","lb",
  "ls","lr","ly","li","lt","lu","mg","mw","my","mv","ml","mt","mh","mr","mu","mx",
  "fm","md","mc","mn","me","ma","mz","mm","na","nr","np","nl","nz","ni","ne","ng",
  "mk","no","om","pk","pw","pa","pg","py","pe","ph","pl","pt","qa","ro","ru","rw",
  "kn","lc","vc","ws","sm","st","sa","sn","rs","sc","sl","sg","sk","si","sb","so",
  "za","ss","es","lk","sd","sr","se","ch","sy","tw","tj","tz","th","tl","tg","to",
  "tt","tn","tr","tm","tv","ug","ua","ae","gb","us","uy","uz","vu","ve","vn","ye",
  "zm","zw"
]);

// Provider detection patterns and rewrite strategies
const PROVIDERS = [
  {
    name: "brightdata",
    detect: /brightdata\.com|luminati\.io|brd\.superproxy/i,
    rewrite: (url, country) => {
      // BrightData format: user-country-XX:pass@host:port
      const u = new URL(url);
      if (u.username && !u.username.includes(`-country-${country}`)) {
        u.username = u.username.replace(/-country-[a-z]{2}/i, "") + `-country-${country}`;
      }
      return u.toString();
    }
  },
  {
    name: "oxylabs",
    detect: /oxylabs\.io/i,
    rewrite: (url, country) => {
      const u = new URL(url);
      if (u.username && !u.username.includes(`-cc-${country}`)) {
        u.username = u.username.replace(/-cc-[a-z]{2}/i, "") + `-cc-${country}`;
      }
      return u.toString();
    }
  },
  {
    name: "smartproxy",
    detect: /smartproxy\.com/i,
    rewrite: (url, country) => {
      const u = new URL(url);
      if (u.username && !u.username.includes(`-cc-${country}`)) {
        u.username = u.username.replace(/-cc-[a-z]{2}/i, "") + `-cc-${country}`;
      }
      return u.toString();
    }
  },
  {
    name: "iproyal",
    detect: /iproyal\.com/i,
    rewrite: (url, country) => {
      const u = new URL(url);
      if (u.username && !u.username.includes(`-country-${country}`)) {
        u.username = u.username.replace(/-country-[a-z]{2}/i, "") + `-country-${country}`;
      }
      return u.toString();
    }
  }
];

class Geotargeting {
  /**
   * @param {string} country - ISO 3166-1 alpha-2 country code (e.g. "us", "gb", "de")
   */
  constructor(country) {
    if (!country || typeof country !== "string") {
      throw new Error("Geotargeting: country code is required");
    }
    this.country = country.toLowerCase();
    if (!COUNTRY_CODES.has(this.country)) {
      throw new Error(`Geotargeting: unknown country code "${this.country}". Use ISO 3166-1 alpha-2 codes.`);
    }
  }

  /**
   * Rewrite a proxy URL to include country targeting.
   * @param {string} proxyUrl
   * @returns {string} Modified proxy URL with country targeting
   */
  rewriteProxy(proxyUrl) {
    if (!proxyUrl) return proxyUrl;

    for (const provider of PROVIDERS) {
      if (provider.detect.test(proxyUrl)) {
        return provider.rewrite(proxyUrl, this.country);
      }
    }

    // Generic fallback: append country to username if auth exists
    try {
      const u = new URL(proxyUrl);
      if (u.username) {
        u.username = u.username.replace(/-country-[a-z]{2}/i, "") + `-country-${this.country}`;
        return u.toString();
      }
    } catch {
      // Not a parseable URL, return as-is
    }

    return proxyUrl;
  }

  /**
   * Rewrite an array of proxy URLs.
   * @param {string[]} proxies
   * @returns {string[]}
   */
  rewriteAll(proxies) {
    return proxies.map(p => this.rewriteProxy(p));
  }

  /**
   * Get a list of all supported country codes.
   * @returns {string[]}
   */
  static supportedCountries() {
    return Array.from(COUNTRY_CODES).sort();
  }
}

module.exports = Geotargeting;
