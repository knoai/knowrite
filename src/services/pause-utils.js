const { Work } = require('../models');

class PausedError extends Error {
  constructor(step) {
    super(`Creation paused at step: ${step}`);
    this.step = step;
    this.name = 'PausedError';
  }
}

async function checkPaused(workId, nextStep) {
  const work = await Work.findByPk(workId, { attributes: ['status', 'pausedAtStep'] });
  if (work && work.status === 'paused') {
    work.pausedAtStep = nextStep;
    await work.save();
    throw new PausedError(nextStep);
  }
}

module.exports = { PausedError, checkPaused };
