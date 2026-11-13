/** @file Отмена load preparation: не начинает следующую операцию после SIGINT/SIGTERM. */
const { setTimeout: delay } = require('node:timers/promises');
/** Уже начатым Docker шагом владеет caller; abort запрещает продолжение после его возврата.
 * Cleanup выполняется отдельным raw transport и не блокируется отменённым signal. */
function createCancellation() {
  const controller = new AbortController();
  return {
    abort() {
      controller.abort();
    },
    check() {
      controller.signal.throwIfAborted();
    },
    async run(operation) {
      controller.signal.throwIfAborted();
      const result = await operation();
      controller.signal.throwIfAborted();
      return result;
    },
    wait(ms) {
      return delay(ms, undefined, { signal: controller.signal });
    },
  };
}
module.exports = { createCancellation };
