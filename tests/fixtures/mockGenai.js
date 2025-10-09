class MockLiveSession {
  constructor(responses = []) {
    this._responses = responses;
    this.sentInputs = [];
    this.closed = false;
  }

  async *receive() {
    for (const response of this._responses) {
      // Simulate asynchronous delivery
      await Promise.resolve();
      yield response;
    }
  }

  async send_realtime_input(payload) {
    this.sentInputs.push(payload);
    return { ok: true };
  }

  async close() {
    this.closed = true;
  }
}

function createMockGenai({ responses = [], replyText = 'Mock reply' } = {}) {
  const session = new MockLiveSession(responses);
  const generateContent = jest.fn().mockResolvedValue({
    candidates: [
      {
        content: {
          parts: [
            {
              text: replyText,
            },
          ],
        },
      },
    ],
  });

  const getGenerativeModel = jest.fn().mockReturnValue({ generateContent });

  const live = {
    connect: jest.fn().mockResolvedValue(session),
  };

  return {
    session,
    genai: {
      live,
      getGenerativeModel,
    },
  };
}

module.exports = {
  MockLiveSession,
  createMockGenai,
};
