const { WebSocketServer } = require('ws');
const { handleInput } = require('./src/providers/geminiLive.js');

function attachLiveGateway(server) {
  const wss = new WebSocketServer({ server, path: '/live' });
  server.on('close', () => wss.close());

  wss.on('connection', (ws) => {
    ws.on('message', (data) => {
      let frame;
      try {
        frame = JSON.parse(data);
      } catch {
        ws.send(
          JSON.stringify({
            type: 'error',
            code: 'bad_request',
            message: 'invalid json',
          })
        );
        return;
      }

      if (!frame.type) {
        ws.send(
          JSON.stringify({
            type: 'error',
            code: 'bad_request',
            message: 'missing type',
          })
        );
        return;
      }

      switch (frame.type) {
        case 'start':
          if (!frame.apiKey) {
            ws.send(
              JSON.stringify({
                type: 'error',
                code: 'bad_request',
                message: 'missing apiKey',
              })
            );
            return;
          }
          ws.send(JSON.stringify({ type: 'status', status: 'ok' }));
          ws.send(JSON.stringify({ type: 'model', model: 'mock-gemini' }));
          break;
        case 'input_text':
        case 'input_audio_buffer':
        case 'input_image': {
          const result = handleInput(frame);
          if (result) ws.send(JSON.stringify(result));
          break;
        }
        case 'end':
          ws.close();
          break;
        default:
          ws.send(
            JSON.stringify({
              type: 'error',
              code: 'bad_request',
              message: 'unknown type',
            })
          );
      }
    });
  });

  return wss;
}

module.exports = { attachLiveGateway };
