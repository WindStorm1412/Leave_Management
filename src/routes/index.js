const { fail } = require('../http');
const handleAuthDashboard = require('./auth-dashboard');
const handleRequests = require('./requests');
const handleEmployee = require('./employee');
const handleHR = require('./hr');
const handleAdmin = require('./admin');
const handleExports = require('./exports');

const handlers = [
  handleAuthDashboard,
  handleRequests,
  handleEmployee,
  handleHR,
  handleAdmin,
  handleExports
];

async function handleApi(req, res, url) {
  for (const handler of handlers) {
    if (await handler(req, res, url)) return;
  }
  fail(res, 404, 'API không tồn tại.');
}

module.exports = handleApi;
