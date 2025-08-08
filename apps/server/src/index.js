const http = require('http');
const { attachLiveGateway } = require('../attachLiveGateway.js');

function createServer() {
  const server = http.createServer();
  attachLiveGateway(server);
  return server;
}

function start() {
  const server = createServer();
  const port = process.env.PORT || 8787;
  server.listen(port, () => {
    console.log(`server listening on ${port}`);
  });
  return server;
}

module.exports = { createServer, start };

if (require.main === module) {
  start();
}
