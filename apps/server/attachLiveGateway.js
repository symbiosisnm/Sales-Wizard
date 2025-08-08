const { WebSocketServer } = require('ws');

function attachLiveGateway(server) {
  const wss = new WebSocketServer({ server, path: '/live' });
  wss.on('connection', (ws) => {
    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }
      switch (msg.type) {
        case 'start':
          ws.send(JSON.stringify({ type: 'status', status: 'ok' }));
          ws.send(JSON.stringify({ type: 'model', model: 'mock-gemini' }));
          break;
        case 'input_text':
          ws.send(JSON.stringify({ type: 'text', text: msg.text }));
          break;
        case 'input_audio_buffer':
          ws.send(JSON.stringify({ type: 'audio', data: msg.data || null }));
          break;
        case 'input_image':
          ws.send(JSON.stringify({ type: 'image', data: msg.data || null }));
          break;
        case 'end':
          ws.close();
          break;
      }
    });
  });
  return wss;
}

module.exports = { attachLiveGateway };
