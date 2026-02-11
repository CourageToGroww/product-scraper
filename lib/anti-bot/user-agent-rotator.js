const UserAgent = require("user-agents");

class UserAgentRotator {
  constructor({ deviceCategory = null } = {}) {
    this.options = {};
    if (deviceCategory) {
      this.options.deviceCategory = deviceCategory;
    }
  }

  get() {
    const ua = new UserAgent(this.options);
    return ua.toString();
  }

  getRandom() {
    return this.get();
  }

  getDesktop() {
    const ua = new UserAgent({ deviceCategory: "desktop" });
    return ua.toString();
  }

  getMobile() {
    const ua = new UserAgent({ deviceCategory: "mobile" });
    return ua.toString();
  }
}

module.exports = UserAgentRotator;
