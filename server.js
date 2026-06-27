const app = require('./src/app');

if (require.main === module) {
  app.runCli();
}

module.exports = app;
