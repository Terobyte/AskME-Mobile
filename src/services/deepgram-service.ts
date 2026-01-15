// src/services/deepgram-service.ts
export class DeepgramService {
  private socket: WebSocket | null = null;
  private apiKey = process.env.EXPO_PUBLIC_DEEPGRAM_API_KEY;

  constructor(private onTranscript: (text: string, isFinal: boolean) => void) {}

  connect() {
    if (!this.apiKey) {
      console.error('Deepgram API Key missing!');
      return;
    }

    // 300ms silence = user stopped talking
    const url = 'wss://api.deepgram.com/v1/listen?encoding=linear16&sample_rate=16000&channel=1&endpointing=300&interim_results=true';
    
    this.socket = new WebSocket(url, ['token', this.apiKey]);

    this.socket.onopen = () => {
      console.log('🟢 Deepgram WebSocket Connected');
    };

    this.socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.channel && data.channel.alternatives[0]) {
          const transcript = data.channel.alternatives[0].transcript;
          const isFinal = data.is_final; // Deepgram says user stopped talking
          
          if (transcript) {
            this.onTranscript(transcript, isFinal);
          }
        }
      } catch (e) {
        console.error('Deepgram parse error', e);
      }
    };

    this.socket.onerror = (e) => console.error('Deepgram Socket Error', e);
    this.socket.onclose = () => console.log('🔴 Deepgram Socket Closed');
  }

  send(base64Audio: string) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      // Deepgram expects raw binary, but Expo often gives base64.
      // Ensure we send what Deepgram expects based on previous working setup.
      // Usually passing binary array buffer is best, but if base64 worked before:
      
      // Convert base64 to binary array buffer
      const binaryString = atob(base64Audio);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      this.socket.send(bytes.buffer);
    }
  }

  close() {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }
}
