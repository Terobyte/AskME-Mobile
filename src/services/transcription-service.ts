import { Platform } from 'react-native';

const OPENAI_API_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY;

export const transcribeAudio = async (uri: string): Promise<string> => {
  try {
    const formData = new FormData();
    
    // Determine file type/extension
    const uriParts = uri.split('.');
    const fileType = uriParts[uriParts.length - 1];
    
    // Append file correctly for React Native
    formData.append('file', {
      uri: Platform.OS === 'ios' ? uri.replace('file://', '') : uri,
      name: `recording.${fileType}`,
      type: `audio/${fileType}`,
    } as any);
    
    formData.append('model', 'whisper-1');

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'multipart/form-data',
      },
      body: formData,
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    
    return data.text || "";
    
  } catch (error) {
    console.error("Transcription Error:", error);
    return "";
  }
};
