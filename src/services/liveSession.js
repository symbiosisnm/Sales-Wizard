class LiveSession {
    constructor(id) {
        this.id = id;
    }

    async sendAudio(_data) {
        // Placeholder for sending audio data to the session
        return true;
    }

    async sendImage(_data) {
        // Placeholder for sending image data to the session
        return true;
    }

    async close() {
        // Placeholder for cleaning up session resources
        return true;
    }
}

module.exports = LiveSession;
