const TOTAL_TIMEOUT = 40000;
const MAX_WAIT_PER_INSTRUCTION = 10000;

class JsInstructor {
  constructor({ verbose = false } = {}) {
    this.verbose = verbose;
  }

  async execute(page, instructions) {
    if (!page || !Array.isArray(instructions) || instructions.length === 0) return;

    const startTime = Date.now();
    let executed = 0;

    for (const instruction of instructions) {
      if (Date.now() - startTime > TOTAL_TIMEOUT) {
        if (this.verbose) console.log("  JS instructions: 40s timeout reached, stopping");
        break;
      }

      try {
        await this._executeOne(page, instruction);
        executed++;
      } catch (err) {
        if (this.verbose) {
          console.log(`  JS instruction failed (${instruction.action}): ${err.message}`);
        }
        // Continue to next instruction on error
      }
    }

    if (this.verbose) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`  JS instructions: ${executed}/${instructions.length} executed in ${elapsed}s`);
    }
  }

  async _executeOne(page, instruction) {
    const { action } = instruction;

    switch (action) {
      case "click":
        this._requireField(instruction, "selector");
        await page.click(instruction.selector);
        break;

      case "fill":
        this._requireField(instruction, "selector");
        this._requireField(instruction, "value");
        await page.type(instruction.selector, String(instruction.value));
        break;

      case "wait": {
        const ms = Math.min(
          Math.max(0, parseInt(instruction.timeout || instruction.value || 0, 10)),
          MAX_WAIT_PER_INSTRUCTION
        );
        await new Promise(r => setTimeout(r, ms));
        break;
      }

      case "wait_for":
        this._requireField(instruction, "selector");
        await page.waitForSelector(instruction.selector, {
          timeout: Math.min(instruction.timeout || 10000, MAX_WAIT_PER_INSTRUCTION)
        });
        break;

      case "scroll_y": {
        const pixels = parseInt(instruction.value || 0, 10);
        await page.evaluate((y) => window.scrollBy(0, y), pixels);
        break;
      }

      case "scroll_x": {
        const pixels = parseInt(instruction.value || 0, 10);
        await page.evaluate((x) => window.scrollBy(x, 0), pixels);
        break;
      }

      case "evaluate":
        this._requireField(instruction, "code");
        await page.evaluate(instruction.code);
        break;

      case "check":
        this._requireField(instruction, "selector");
        await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (el && !el.checked) el.click();
        }, instruction.selector);
        break;

      case "uncheck":
        this._requireField(instruction, "selector");
        await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (el && el.checked) el.click();
        }, instruction.selector);
        break;

      case "select_option":
        this._requireField(instruction, "selector");
        this._requireField(instruction, "value");
        await page.select(instruction.selector, String(instruction.value));
        break;

      default:
        throw new Error(`Unknown JS instruction action: ${action}`);
    }
  }

  _requireField(instruction, field) {
    if (instruction[field] === undefined || instruction[field] === null) {
      throw new Error(`JS instruction "${instruction.action}" requires "${field}"`);
    }
  }
}

module.exports = JsInstructor;
